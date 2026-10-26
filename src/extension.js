'use strict';

const vscode = require('vscode');
const cp = require('child_process');
const os = require('os');

const SECTION = 'codexbarUsage';
const EXEC_TIMEOUT_MS = 90000;

/** @type {vscode.StatusBarItem|null} */
let statusItem = null;
/** @type {vscode.OutputChannel|null} */
let channel = null;
/** @type {NodeJS.Timeout|null} */
let timer = null;
let inFlight = false;
let lastFocusRefresh = 0;
/** @type {{host:string, at:Date, providers:Object}|null} */
let snapshot = null;

function settings() {
  const c = vscode.workspace.getConfiguration(SECTION);
  return {
    executable: c.get('executable') || 'codexbar',
    extraPath: c.get('extraPath') || [],
    showCodex: c.get('showCodex') !== false,
    codexMetric: c.get('codexMetric') === 'used' ? 'used' : 'remaining',
    showDeepSeek: c.get('showDeepSeek') !== false,
    showResetCredits: c.get('showResetCredits') === true,
    showCredits: c.get('showCredits') === true,
    refreshMode: c.get('refreshMode') || 'adaptive',
    refreshMinutes: Math.max(1, Number(c.get('refreshMinutes') ?? 10)),
    refreshOnFocus: c.get('refreshOnFocus') !== false,
    warnThreshold: Number(c.get('warnThreshold') ?? 80),
    errorThreshold: Number(c.get('errorThreshold') ?? 95)
  };
}

function log(line) {
  if (channel) channel.appendLine(`[${new Date().toISOString()}] ${line}`);
}

function resolvePath() {
  const { extraPath } = settings();
  const base = (process.env.PATH || '/usr/bin:/bin').split(':');
  return [...new Set([...extraPath, ...base].filter(Boolean))].join(':');
}

function run(args) {
  const { executable } = settings();
  return new Promise((resolve, reject) => {
    cp.execFile(
      executable,
      args,
      { timeout: EXEC_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, PATH: resolvePath() } },
      (err, stdout, stderr) => {
        if (err) {
          err.userMessage = describeError(err, stderr);
          return reject(err);
        }
        resolve(stdout);
      }
    );
  });
}

function describeError(err, stderr) {
  if (err.code === 'ENOENT') return `${settings().executable} not found on ${os.hostname()}`;
  const text = String(stderr || err.message || '').trim().split('\n').slice(-3).join(' ');
  return text.slice(0, 400) || String(err.message);
}

async function fetchProvider(provider) {
  try {
    const raw = await run(['usage', '--provider', provider, '--format', 'json']);
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed[0] : parsed;
  } catch (err) {
    log(`${provider} failed: ${err.userMessage || err.message}`);
    return { error: err.userMessage || String(err.message) };
  }
}

async function fetchAll() {
  const wanted = [];
  const s = settings();
  if (s.showCodex) wanted.push('codex');
  if (s.showDeepSeek) wanted.push('deepseek');
  const results = await Promise.all(wanted.map(p => fetchProvider(p)));
  const providers = {};
  wanted.forEach((p, i) => { providers[p] = results[i]; });
  return { host: os.hostname(), at: new Date(), providers };
}

function pct(v) {
  return v === null || v === undefined ? '–' : `${Math.round(v)}%`;
}

function money(text) {
  const m = String(text || '').match(/[¥￥]\s*([0-9]+(?:\.[0-9]+)?)/);
  return m ? `¥${Number(m[1]).toFixed(2)}` : '';
}

function codexWeekly(codex) {
  const u = (codex && codex.usage) || {};
  return u.secondary && typeof u.secondary.usedPercent === 'number' ? u.secondary : null;
}

function statusText(state) {
  const s = settings();
  const parts = [];
  const codex = state.providers.codex;
  const ds = state.providers.deepseek;

  if (s.showCodex) {
    const weekly = codexWeekly(codex);
    if (weekly) {
      const used = Math.round(weekly.usedPercent);
      parts.push(s.codexMetric === 'used' ? `Codex ${used}% used` : `Codex ${100 - used}% left`);
    }
    else if (codex && codex.error) parts.push('Codex ✗');
  }
  if (s.showCodex && s.showCredits) {
    const remaining = codex && codex.credits && codex.credits.remaining;
    if (typeof remaining === 'number' && remaining > 0) parts.push(`${remaining} cr`);
  }
  if (s.showCodex && s.showResetCredits) {
    const resets = codex && codex.resetCredits && codex.resetCredits.available;
    if (resets) parts.push(`券${resets}`);
  }
  if (s.showDeepSeek) {
    const balance = ds && ds.usage && ds.usage.primary ? money(ds.usage.primary.resetDescription) : '';
    if (balance) parts.push(`DS ${balance}`);
    else if (ds && ds.error) parts.push('DS ✗');
  }
  return parts.length ? `$(pulse) ${parts.join(' · ')}` : '$(pulse) codexbar';
}

function severity(state) {
  const s = settings();
  const weekly = codexWeekly(state.providers.codex);
  if (!weekly) return 'none';
  if (weekly.usedPercent >= s.errorThreshold) return 'error';
  if (weekly.usedPercent >= s.warnThreshold) return 'warn';
  return 'none';
}

function formatLocal(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function windowLines(provider) {
  const u = (provider && provider.usage) || {};
  const labels = (provider && provider.rateWindowLabels) || {};
  const out = [];
  for (const key of ['primary', 'secondary', 'tertiary']) {
    const w = u[key];
    if (!w) continue;
    const label = labels[key] || (w.windowMinutes ? `${Math.round(w.windowMinutes / 60)}h window` : key);
    const bits = [];
    if (label !== 'Balance' && typeof w.usedPercent === 'number') {
      bits.push(`${pct(w.usedPercent)} used · ${100 - Math.round(w.usedPercent)}% left`);
    }
    if (w.resetDescription) bits.push(w.resetDescription);
    else if (w.resetsAt) bits.push(`resets ${formatLocal(w.resetsAt)}`);
    if (bits.length) out.push(`- ${label}: ${bits.join(' · ')}`);
  }
  return out;
}

function tooltip(state) {
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**CodexBar** · \`${state.host}\`\n\n`);
  md.appendMarkdown(`_updated ${state.at.toLocaleTimeString()} · click for actions_\n\n`);
  for (const [name, provider] of Object.entries(state.providers)) {
    md.appendMarkdown(`---\n\n**${name}**\n\n`);
    if (!provider || provider.error) {
      md.appendMarkdown(`error: ${(provider && provider.error) || 'no data'}\n\n`);
      continue;
    }
    const u = provider.usage || {};
    const account = (u.identity && u.identity.accountEmail) || provider.account || '';
    if (account) md.appendMarkdown(`account: \`${account}\`${u.loginMethod ? ' · ' + u.loginMethod : ''}\n\n`);
    const lines = windowLines(provider);
    if (lines.length) md.appendMarkdown(lines.join('\n') + '\n');
    const credits = provider.credits;
    if (credits && credits.balanceReadSucceeded && typeof credits.remaining === 'number' && credits.remaining > 0) {
      md.appendMarkdown(`- credits: ${credits.remaining}\n`);
    }
    const resets = provider.resetCredits;
    if (resets && resets.available) {
      md.appendMarkdown(`- reset credits: ${resets.available}${resets.nextExpiresAt ? ` (next expires ${formatLocal(resets.nextExpiresAt)})` : ''}\n`);
    }
    md.appendMarkdown('\n');
  }
  md.appendMarkdown(`_click the item for refresh / details / settings_`);
  return md;
}

function paint() {
  if (!statusItem || !snapshot) return;
  const s = settings();
  statusItem.text = statusText(snapshot);
  statusItem.tooltip = tooltip(snapshot);
  const level = severity(snapshot);
  statusItem.backgroundColor = level === 'error'
    ? new vscode.ThemeColor('statusBarItem.errorBackground')
    : level === 'warn'
      ? new vscode.ThemeColor('statusBarItem.warningBackground')
      : undefined;
}

async function refresh({ silent = false } = {}) {
  if (inFlight) return;
  inFlight = true;
  if (statusItem) statusItem.text = '$(sync~spin) codexbar';
  try {
    snapshot = await fetchAll();
    log(`refreshed on ${snapshot.host}: ${Object.keys(snapshot.providers).join(', ')}`);
    paint();
  } catch (err) {
    log(`refresh failed: ${err.message}`);
    if (!silent) vscode.window.showErrorMessage(`CodexBar: ${err.message}`);
  } finally {
    inFlight = false;
    scheduleRefresh();
  }
}

const ADAPTIVE_IDLE_MIN = 10;
const ADAPTIVE_WARN_MIN = 3;
const ADAPTIVE_HOT_MIN = 1;
const ADAPTIVE_ERROR_MIN = 5;

/** Adaptive cadence, mirroring CodexBar's own 'adaptive' refresh: idle polling is
 *  slow, and it tightens as the weekly window fills up or when a fetch keeps failing. */
function nextIntervalMs() {
  const s = settings();
  if (s.refreshMode === 'off') return 0;
  if (s.refreshMode === 'fixed') return s.refreshMinutes * 60000;

  const weekly = snapshot ? codexWeekly(snapshot.providers.codex) : null;
  if (snapshot && Object.values(snapshot.providers).some(p => p && p.error)) return ADAPTIVE_ERROR_MIN * 60000;
  if (!weekly) return ADAPTIVE_IDLE_MIN * 60000;
  if (weekly.usedPercent >= s.errorThreshold) return ADAPTIVE_HOT_MIN * 60000;
  if (weekly.usedPercent >= s.warnThreshold) return ADAPTIVE_WARN_MIN * 60000;
  return ADAPTIVE_IDLE_MIN * 60000;
}

function scheduleRefresh() {
  if (timer) clearTimeout(timer);
  timer = null;
  const ms = nextIntervalMs();
  if (!ms) return;
  timer = setTimeout(async () => {
    await refresh({ silent: true });
    scheduleRefresh();
  }, ms);
  log(`next refresh in ${Math.round(ms / 60000)} min (mode=${settings().refreshMode})`);
}

async function showDetails() {
  if (!snapshot) {
    await refresh({ silent: true });
  }
  if (!snapshot) return vscode.window.showWarningMessage('CodexBar: no data yet.');
  const rows = [];
  for (const [name, provider] of Object.entries(snapshot.providers)) {
    if (!provider || provider.error) {
      rows.push(`${name}: error — ${(provider && provider.error) || 'no data'}`);
      continue;
    }
    const bits = windowLines(provider).map(l => l.replace(/^- /, ''));
    if (!bits.length) bits.push('ok');
    rows.push(`${name}: ${bits.join(' | ')}`);
  }
  const pick = await vscode.window.showQuickPick(
    [
      { label: '$(refresh) Refresh now', action: 'refresh' },
      { label: '$(gear) Open settings', action: 'settings' },
      ...rows.map(r => ({ label: r, action: 'none' }))
    ],
    { title: `CodexBar @ ${snapshot.host}`, placeHolder: `updated ${snapshot.at.toLocaleTimeString()}` }
  );
  if (!pick) return;
  if (pick.action === 'refresh') return refresh();
  if (pick.action === 'settings') return openSettings();
}

function openSettings() {
  vscode.commands.executeCommand('workbench.action.openSettings', SECTION);
}

function activate(context) {
  channel = vscode.window.createOutputChannel('CodexBar');
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.name = 'CodexBar Usage';
  statusItem.command = 'codexbarUsage.menu';
  statusItem.show();

  context.subscriptions.push(
    channel,
    statusItem,
    vscode.commands.registerCommand('codexbarUsage.menu', showDetails),
    vscode.commands.registerCommand('codexbarUsage.refresh', () => refresh()),
    vscode.commands.registerCommand('codexbarUsage.showDetails', showDetails),
    vscode.commands.registerCommand('codexbarUsage.openSettings', openSettings),
    vscode.window.onDidChangeWindowState(state => {
      if (!state.focused || !settings().refreshOnFocus) return;
      const now = Date.now();
      if (now - lastFocusRefresh < 60000) return;
      lastFocusRefresh = now;
      refresh({ silent: true });
    }),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (!e.affectsConfiguration(SECTION)) return;
      scheduleRefresh();
      if (snapshot) paint();
      refresh({ silent: true });
    })
  );

  refresh({ silent: true });
  scheduleRefresh();
}

function deactivate() {
  if (timer) clearTimeout(timer);
  timer = null;
}

module.exports = { activate, deactivate, _internals: { statusText, windowLines, money, codexWeekly, severity, formatLocal } };
