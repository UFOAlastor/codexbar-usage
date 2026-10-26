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
let expanded = false;
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

/* ---------- formatting helpers ---------- */

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

function codexPrimary(codex) {
  const u = (codex && codex.usage) || {};
  return u.primary && typeof u.primary.usedPercent === 'number' ? u.primary : null;
}

function pad(n) { return String(n).padStart(2, '0'); }

function formatLocal(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Compact countdown such as `6d23h`, `3h12m`, `14m`. */
function countdown(iso) {
  if (!iso) return '';
  const target = new Date(iso).getTime();
  if (isNaN(target)) return '';
  let diff = target - Date.now();
  if (diff <= 0) return 'now';
  const d = Math.floor(diff / 86400000); diff -= d * 86400000;
  const h = Math.floor(diff / 3600000); diff -= h * 3600000;
  const m = Math.floor(diff / 60000);
  if (d > 0) return `${d}d${h}h`;
  if (h > 0) return `${h}h${pad(m)}m`;
  return `${m}m`;
}

/** Reset credits appear both at the top level and under usage.codexResetCredits. */
function resetCredits(codex) {
  const top = (codex && codex.resetCredits) || {};
  const nested = (codex && codex.usage && codex.usage.codexResetCredits) || {};
  const list = Array.isArray(nested.credits) ? nested.credits : [];
  const available = top.available ?? nested.availableCount
    ?? list.filter(c => c.status === 'available').length;
  return {
    available,
    nextExpiresAt: top.nextExpiresAt || (list[0] && list[0].expires_at) || '',
    list
  };
}

/* ---------- status bar ---------- */

function statusText(state, isExpanded) {
  const s = settings();
  const parts = [];
  const codex = state.providers.codex;
  const ds = state.providers.deepseek;

  if (s.showCodex) {
    const primary = codexPrimary(codex);
    const weekly = codexWeekly(codex);
    if (primary && isExpanded) {
      const used = Math.round(primary.usedPercent);
      parts.push(s.codexMetric === 'used' ? `5h ${used}%` : `5h ${100 - used}% left`);
    }
    if (weekly) {
      const used = Math.round(weekly.usedPercent);
      parts.push(s.codexMetric === 'used' ? `Codex ${used}% used` : `Codex ${100 - used}% left`);
      if (isExpanded && weekly.resetsAt) parts.push(`↻${countdown(weekly.resetsAt)}`);
    } else if (codex && codex.error) {
      parts.push('Codex ✗');
    }
    if (codex && !codex.error) {
      const rc = resetCredits(codex);
      const creditsLeft = codex.credits && codex.credits.remaining;
      if ((isExpanded || s.showCredits) && typeof creditsLeft === 'number' && creditsLeft > 0) {
        parts.push(`${creditsLeft} cr`);
      }
      if ((isExpanded || s.showResetCredits) && rc.available) {
        parts.push(`券${rc.available}${isExpanded && rc.nextExpiresAt ? `(${countdown(rc.nextExpiresAt)})` : ''}`);
      }
    }
  }

  if (s.showDeepSeek) {
    const balance = ds && ds.usage && ds.usage.primary ? money(ds.usage.primary.resetDescription) : '';
    if (balance) parts.push(`DS ${balance}`);
    else if (ds && ds.error) parts.push('DS ✗');
  }

  const icon = isExpanded ? '$(chevron-down)' : '$(pulse)';
  return `${icon} ${parts.length ? parts.join(' · ') : 'codexbar'}`;
}

function severity(state) {
  const s = settings();
  const weekly = codexWeekly(state.providers.codex);
  if (!weekly) return 'none';
  if (weekly.usedPercent >= s.errorThreshold) return 'error';
  if (weekly.usedPercent >= s.warnThreshold) return 'warn';
  return 'none';
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
      bits.push(`${Math.round(w.usedPercent)}% used · ${100 - Math.round(w.usedPercent)}% left`);
      if (w.resetsAt) bits.push(`↻ ${countdown(w.resetsAt)}`);
    }
    if (w.resetDescription) bits.push(w.resetDescription);
    else if (w.resetsAt) bits.push(`resets ${formatLocal(w.resetsAt)}`);
    if (bits.length) out.push({ label, text: bits.join(' · ') });
  }
  return out;
}

/** The detail "sticker": a compact card anchored to the status bar item. Hovering
 *  shows it; the links inside are clickable because the markdown is trusted. */
function detailCard(state) {
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = { enabledCommands: ['codexbarUsage.refresh', 'codexbarUsage.openSettings', 'codexbarUsage.toggle'] };
  md.supportThemeIcons = true;
  md.appendMarkdown(`**CodexBar** · \`${state.host}\`\n\n`);
  md.appendMarkdown(
    `<sub>updated ${state.at.toLocaleTimeString()} · ` +
    `[$(refresh) Refresh](command:codexbarUsage.refresh) · ` +
    `[$(gear) Settings](command:codexbarUsage.openSettings) · ` +
    `[$(pin) Pin to status bar](command:codexbarUsage.toggle)</sub>\n\n`
  );

  for (const [name, provider] of Object.entries(state.providers)) {
    md.appendMarkdown('---\n\n');
    if (!provider || provider.error) {
      md.appendMarkdown(`**${name}** — error: ${(provider && provider.error) || 'no data'}\n\n`);
      continue;
    }
    const u = provider.usage || {};
    const account = (u.identity && u.identity.accountEmail) || provider.account || '';
    const plan = u.loginMethod || (u.identity && u.identity.loginMethod) || '';
    md.appendMarkdown(`**${name}**${account ? ` · \`${account}\`` : ''}${plan ? ` · ${plan}` : ''}\n\n`);
    for (const line of windowLines(provider)) {
      md.appendMarkdown(`- ${line.label}: ${line.text}\n`);
    }
    const credits = provider.credits;
    if (credits && credits.balanceReadSucceeded && typeof credits.remaining === 'number') {
      md.appendMarkdown(`- credits: ${credits.remaining}\n`);
    }
    const cost = u.providerCost;
    if (cost && cost.limit) {
      md.appendMarkdown(`- ${cost.period || 'extra usage'}: ${cost.used}/${cost.limit} ${cost.currencyCode || ''}\n`);
    }
    const rc = resetCredits(provider);
    if (rc.available) {
      md.appendMarkdown(`- reset credits: ${rc.available}\n`);
      for (const credit of rc.list.slice(0, 4)) {
        if (credit.status && credit.status !== 'available') continue;
        md.appendMarkdown(`  - ${credit.title || 'reset'} · expires ${formatLocal(credit.expires_at)} (${countdown(credit.expires_at)})\n`);
      }
    }
    const meta = [];
    if (provider.source) meta.push(`source ${provider.source}`);
    if (u.dataConfidence) meta.push(`confidence ${u.dataConfidence}`);
    if (provider.version) meta.push(`codexbar ${provider.version}`);
    if (meta.length) md.appendMarkdown(`\n<sub>${meta.join(' · ')}</sub>\n`);
    md.appendMarkdown('\n');
  }
  return md;
}

function paint() {
  if (!statusItem || !snapshot) return;
  statusItem.text = statusText(snapshot, expanded);
  statusItem.tooltip = detailCard(snapshot);
  const level = severity(snapshot);
  statusItem.backgroundColor = level === 'error'
    ? new vscode.ThemeColor('statusBarItem.errorBackground')
    : level === 'warn'
      ? new vscode.ThemeColor('statusBarItem.warningBackground')
      : undefined;
}

/* ---------- refresh ---------- */

async function refresh({ silent = false } = {}) {
  if (inFlight) return;
  inFlight = true;
  if (statusItem && !snapshot) statusItem.text = '$(sync~spin) codexbar';
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

/** Adaptive cadence, mirroring CodexBar's own 'adaptive' refresh setting. */
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

/* ---------- commands ---------- */

function toggleExpanded() {
  expanded = !expanded;
  paint();
}

async function showDetails() {
  if (!snapshot) await refresh({ silent: true });
  if (!snapshot) return vscode.window.showWarningMessage('CodexBar: no data yet.');
  const rows = [];
  for (const [name, provider] of Object.entries(snapshot.providers)) {
    if (!provider || provider.error) {
      rows.push({ label: `$(error) ${name}: ${(provider && provider.error) || 'no data'}`, action: 'none' });
      continue;
    }
    const lines = windowLines(provider);
    const text = lines.length ? lines.map(l => `${l.label} ${l.text}`).join(' | ') : 'ok';
    rows.push({ label: `$(graph) ${name}: ${text}`, action: 'none' });
  }
  const pick = await vscode.window.showQuickPick(
    [
      { label: '$(refresh) Refresh now', action: 'refresh' },
      { label: '$(pin) Toggle pinned details', action: 'toggle' },
      { label: '$(gear) Open settings', action: 'settings' },
      ...rows
    ],
    { title: `CodexBar @ ${snapshot.host}`, placeHolder: `updated ${snapshot.at.toLocaleTimeString()}` }
  );
  if (!pick) return;
  if (pick.action === 'refresh') return refresh();
  if (pick.action === 'toggle') return toggleExpanded();
  if (pick.action === 'settings') return openSettings();
}

function openSettings() {
  vscode.commands.executeCommand('workbench.action.openSettings', SECTION);
}

function activate(context) {
  channel = vscode.window.createOutputChannel('CodexBar');
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.name = 'CodexBar Usage';
  statusItem.command = 'codexbarUsage.toggle';
  statusItem.show();

  context.subscriptions.push(
    channel,
    statusItem,
    vscode.commands.registerCommand('codexbarUsage.toggle', toggleExpanded),
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

module.exports = {
  activate,
  deactivate,
  _internals: { statusText, windowLines, money, codexWeekly, severity, formatLocal, countdown, resetCredits, detailCard }
};
