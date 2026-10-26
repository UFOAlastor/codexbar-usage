'use strict';

const vscode = require('vscode');
const cp = require('child_process');
const os = require('os');

const SECTION = 'codexbarUsage';
const EXEC_TIMEOUT_MS = 90000;
const WINDOW_KEYS = ['primary', 'secondary', 'tertiary'];

/** Short labels for the providers people actually run; anything else falls back
 *  to the id itself, capitalised. */
const SHORT_LABELS = {
  codex: 'Codex',
  claude: 'Claude',
  claudeplatform: 'Claude',
  deepseek: 'DS',
  gemini: 'Gemini',
  copilot: 'Copilot',
  cursor: 'Cursor',
  openrouter: 'OR',
  zai: 'Z.ai',
  kimi: 'Kimi',
  minimax: 'MiniMax',
  xai: 'Grok',
  nous: 'Nous',
  factory: 'Factory',
  devin: 'Devin',
  kilo: 'Kilo',
  kiro: 'Kiro',
  qwencloud: 'Qwen',
  alibaba: 'Alibaba',
  openai: 'OpenAI',
  azureopenai: 'Azure',
  vertexai: 'Vertex',
  tavily: 'Tavily',
  exa: 'Exa',
  huggingface: 'HF',
  replicate: 'Replicate',
  fireworks: 'Fireworks',
  synthetic: 'Synthetic',
  venice: 'Venice',
  groqcloud: 'Groq',
  mistral: 'Mistral',
  perplexity: 'Perplexity',
  warp: 'Warp',
  windsurf: 'Windsurf',
  zed: 'Zed'
};

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
    providers: Array.isArray(c.get('providers')) ? c.get('providers') : [],
    statusBarLimit: Math.max(1, Number(c.get('statusBarLimit') ?? 3)),
    // `codexMetric` is the pre-0.4 name; keep honouring it for existing setups.
    metric: (c.get('metric') || c.get('codexMetric')) === 'used' ? 'used' : 'remaining',
    showCounters: c.get('showCounters') === true,
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
      { timeout: EXEC_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, PATH: resolvePath() } },
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

function providerError(entry) {
  const err = entry && entry.error;
  if (!err) return '';
  if (typeof err === 'string') return err;
  return err.message || JSON.stringify(err).slice(0, 300);
}

/* ---------- fetching ---------- */

const FETCH_ATTEMPTS = 2;

/** Ask CodexBar for the providers *it* has enabled: no `--provider` flag means
 *  "honour the in-app toggles", which keeps the call small and fast. */
async function fetchEnabled() {
  let lastError = null;
  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt++) {
    try {
      const raw = await run(['usage', '--format', 'json']);
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch (err) {
      lastError = err;
      log(`enabled-providers fetch attempt ${attempt + 1} failed: ${err.userMessage || err.message}`);
    }
  }
  return [{ provider: 'all', error: { message: (lastError && (lastError.userMessage || lastError.message)) || 'unknown error' } }];
}

/** Explicit provider list from settings: one call per provider, in parallel. */
async function fetchExplicit(names) {
  return Promise.all(names.map(async name => {
    let lastError = null;
    for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt++) {
      for (const extra of [[], ['--source', 'cli']]) {
        try {
          const raw = await run(['usage', '--provider', name, '--format', 'json', ...extra]);
          const parsed = JSON.parse(raw);
          const entry = Array.isArray(parsed) ? parsed[0] : parsed;
          return { ...entry, provider: (entry && entry.provider) || name };
        } catch (err) {
          lastError = err;
          log(`${name} attempt ${attempt + 1} (${extra.join(' ') || 'default'}) failed: ${err.userMessage || err.message}`);
        }
      }
    }
    return { provider: name, error: { message: (lastError && (lastError.userMessage || lastError.message)) || 'unknown error' } };
  }));
}

async function fetchAll() {
  const s = settings();
  const entries = s.providers.length ? await fetchExplicit(s.providers) : await fetchEnabled();
  const now = new Date();
  const providers = {};

  // A now-argument call failed as a whole ("all" pseudo-provider): keep every
  // previously known provider and mark it stale instead of showing a single error.
  if (!s.providers.length && entries.length === 1 && entries[0] && entries[0].provider === 'all' && providerError(entries[0])) {
    const reason = providerError(entries[0]);
    if (snapshot && Object.keys(snapshot.providers).length) {
      const carried = {};
      for (const [id, provider] of Object.entries(snapshot.providers)) {
        carried[id] = provider.error
          ? provider
          : { ...provider, stale: true, staleSince: provider.fetchedAt || snapshot.at, lastError: reason };
      }
      log(`enabled fetch failed (${reason}); keeping ${Object.keys(carried).length} stale provider(s)`);
      return { host: os.hostname(), at: now, providers: carried };
    }
    return { host: os.hostname(), at: now, providers: { codexbar: { provider: 'codexbar', error: { message: reason } } } };
  }

  for (const entry of entries) {
    if (!entry) continue;
    const id = entry.provider || 'unknown';
    const err = providerError(entry);
    if (err) {
      const previous = snapshot && snapshot.providers && snapshot.providers[id];
      // Keep the last good reading rather than blanking the item.
      providers[id] = previous && !previous.error
        ? { ...previous, stale: true, staleSince: previous.fetchedAt || snapshot.at, lastError: err }
        : { ...entry, provider: id, error: { message: err } };
    } else {
      providers[id] = { ...entry, provider: id, fetchedAt: now };
    }
  }
  return { host: os.hostname(), at: now, providers };
}

/* ---------- formatting helpers ---------- */

function pad(n) { return String(n).padStart(2, '0'); }

function shortLabel(provider) {
  const id = String((provider && provider.provider) || '');
  if (SHORT_LABELS[id]) return SHORT_LABELS[id];
  return id ? id.charAt(0).toUpperCase() + id.slice(1, 7) : '?';
}

function money(text) {
  if (typeof text === 'number') return String(text);
  const m = String(text || '').match(/([¥￥$€£])\s*([0-9]+(?:\.[0-9]+)?)/);
  return m ? `${m[1]}${Number(m[2]).toFixed(2)}` : '';
}

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

/** Every window the provider exposes, in a stable shape. A window without a
 *  percentage is treated as a balance-style readout (credits, money, plan). */
function windows(provider) {
  const u = (provider && provider.usage) || {};
  const labels = (provider && provider.rateWindowLabels) || {};
  const out = [];
  for (const key of WINDOW_KEYS) {
    const w = u[key];
    if (!w) continue;
    const label = labels[key] || (w.windowMinutes ? `${Math.round(w.windowMinutes / 60)}h` : key);
    out.push({
      key,
      label,
      isBalance: label === 'Balance' || w.usedPercent === undefined || w.usedPercent === null,
      usedPercent: typeof w.usedPercent === 'number' ? w.usedPercent : null,
      resetsAt: w.resetsAt || '',
      resetDescription: w.resetDescription || '',
      balance: money(w.resetDescription)
    });
  }
  return out;
}

/** The window that matters most: the most consumed one that has a percentage. */
function limitingWindow(provider) {
  const list = windows(provider);
  const withPct = list.filter(w => !w.isBalance);
  if (withPct.length) return withPct.reduce((a, b) => (b.usedPercent > a.usedPercent ? b : a));
  const balanceWindow = list.find(w => w.balance);
  return balanceWindow || list[0] || null;
}

function providerValue(provider, metric) {
  const w = limitingWindow(provider);
  if (!w) return '';
  if (w.balance) return w.balance;
  if (w.usedPercent === null) return '';
  const used = Math.round(w.usedPercent);
  return metric === 'used' ? `${used}% used` : `${100 - used}% left`;
}

/** Banked credits / reset credits, whatever shape the provider reports. */
function counters(provider) {
  const out = [];
  const credits = provider && provider.credits;
  if (credits && credits.balanceReadSucceeded !== false &&
      typeof credits.remaining === 'number' && credits.remaining > 0) {
    out.push({ kind: 'credits', value: String(credits.remaining) });
  }
  const top = (provider && provider.resetCredits) || {};
  const nested = (provider && provider.usage && provider.usage.codexResetCredits) || {};
  const list = Array.isArray(nested.credits) ? nested.credits : [];
  const available = top.available ?? nested.availableCount
    ?? list.filter(c => c.status === 'available').length;
  if (available) {
    out.push({
      kind: 'resets',
      value: String(available),
      nextExpiresAt: top.nextExpiresAt || (list[0] && list[0].expires_at) || '',
      list
    });
  }
  return out;
}

function severity(state) {
  const s = settings();
  let level = 'none';
  for (const provider of Object.values(state.providers)) {
    if (!provider || provider.error) continue;
    const w = limitingWindow(provider);
    if (!w || w.usedPercent === null) continue;
    if (w.usedPercent >= s.errorThreshold) return 'error';
    if (w.usedPercent >= s.warnThreshold) level = 'warn';
  }
  return level;
}

/* ---------- status bar ---------- */

function statusText(state, isExpanded) {
  const s = settings();
  const healthy = Object.values(state.providers).filter(p => p && !p.error);
  // Most constrained first, so the status bar shows what is about to run out.
  const ranked = healthy.slice().sort((a, b) => {
    const wa = limitingWindow(a);
    const wb = limitingWindow(b);
    const ua = wa && wa.usedPercent !== null ? wa.usedPercent : -1;
    const ub = wb && wb.usedPercent !== null ? wb.usedPercent : -1;
    return ub - ua;
  });
  const shown = ranked.slice(0, isExpanded ? s.statusBarLimit + 2 : s.statusBarLimit);

  const parts = [];
  for (const provider of shown) {
    const value = providerValue(provider, s.metric);
    if (!value) continue;
    const mark = provider.stale ? '~' : '';
    parts.push(`${shortLabel(provider)} ${mark}${value}`);
    if (isExpanded) {
      const w = limitingWindow(provider);
      if (w && w.resetsAt) parts.push(`↻${countdown(w.resetsAt)}`);
      if (s.showCounters) {
        for (const c of counters(provider)) {
          parts.push(c.kind === 'resets' ? `券${c.value}` : `${c.value} cr`);
        }
      }
    }
  }
  if (!parts.length) {
    const failures = Object.values(state.providers).filter(p => p && p.error);
    parts.push(failures.length ? `codexbar ✗ ${failures.length}` : 'codexbar');
  }

  const icon = isExpanded ? '$(chevron-down)' : '$(pulse)';
  return `${icon} ${parts.join(' · ')}`;
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

  for (const [id, provider] of Object.entries(state.providers)) {
    md.appendMarkdown('---\n\n');
    if (!provider || provider.error) {
      md.appendMarkdown(`**${id}** — ${providerError(provider) || 'no data'}\n\n`);
      continue;
    }
    const u = provider.usage || {};
    const account = (u.identity && u.identity.accountEmail) || provider.account || '';
    const plan = u.loginMethod || (u.identity && u.identity.loginMethod) || '';
    md.appendMarkdown(`**${id}**${account ? ` · \`${account}\`` : ''}${plan ? ` · ${plan}` : ''}\n\n`);
    if (provider.stale) {
      md.appendMarkdown(`> stale — last good reading ${formatLocal(provider.staleSince)}<br>> ${provider.lastError || 'fetch failed'}\n\n`);
    }
    for (const w of windows(provider)) {
      const bits = [];
      if (!w.isBalance && w.usedPercent !== null) {
        bits.push(`${Math.round(w.usedPercent)}% used · ${100 - Math.round(w.usedPercent)}% left`);
        if (w.resetsAt) bits.push(`↻ ${countdown(w.resetsAt)}`);
      }
      if (w.resetDescription) bits.push(w.resetDescription);
      else if (w.resetsAt) bits.push(`resets ${formatLocal(w.resetsAt)}`);
      if (bits.length) md.appendMarkdown(`- ${w.label}: ${bits.join(' · ')}\n`);
    }
    const cost = u.providerCost;
    if (cost && cost.limit) {
      md.appendMarkdown(`- ${cost.period || 'extra usage'}: ${cost.used}/${cost.limit} ${cost.currencyCode || ''}\n`);
    }
    for (const c of counters(provider)) {
      if (c.kind === 'credits') {
        md.appendMarkdown(`- credits: ${c.value}\n`);
      } else {
        md.appendMarkdown(`- reset credits: ${c.value}${c.nextExpiresAt ? ` (next expires ${formatLocal(c.nextExpiresAt)})` : ''}\n`);
        for (const credit of c.list.slice(0, 4)) {
          if (credit.status && credit.status !== 'available') continue;
          md.appendMarkdown(`  - ${credit.title || 'reset'} · expires ${formatLocal(credit.expires_at)} (${countdown(credit.expires_at)})\n`);
        }
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
  if (!snapshot) return ADAPTIVE_IDLE_MIN * 60000;

  if (Object.values(snapshot.providers).some(p => p && p.error)) return ADAPTIVE_ERROR_MIN * 60000;
  const level = severity(snapshot);
  if (level === 'error') return ADAPTIVE_HOT_MIN * 60000;
  if (level === 'warn') return ADAPTIVE_WARN_MIN * 60000;
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

const REFRESH_BUTTON = { iconPath: new vscode.ThemeIcon('refresh'), tooltip: 'Refresh now' };
const PIN_BUTTON = { iconPath: new vscode.ThemeIcon('pin'), tooltip: 'Pin details into the status bar' };

/** Detail dialog shown on click: one row per provider window, with refresh and
 *  pin available as buttons on the first row. */
async function showDetails() {
  if (!snapshot) await refresh({ silent: true });
  if (!snapshot) return vscode.window.showWarningMessage('CodexBar: no data yet.');

  const items = [];
  for (const [id, provider] of Object.entries(snapshot.providers)) {
    if (!provider || provider.error) {
      items.push({ label: `$(error) ${id}`, description: 'fetch failed', detail: providerError(provider) || 'no data' });
      continue;
    }
    const u = provider.usage || {};
    const account = (u.identity && u.identity.accountEmail) || provider.account || '';
    const stale = provider.stale ? ` · stale since ${formatLocal(provider.staleSince)}` : '';
    const detail = [account, `updated ${formatLocal(provider.fetchedAt || snapshot.at)}${stale}`].filter(Boolean).join(' · ');
    for (const w of windows(provider)) {
      const bits = [];
      if (!w.isBalance && w.usedPercent !== null) {
        bits.push(`${Math.round(w.usedPercent)}% used · ${100 - Math.round(w.usedPercent)}% left`);
        if (w.resetsAt) bits.push(`↻ ${countdown(w.resetsAt)}`);
      }
      if (w.resetDescription) bits.push(w.resetDescription);
      else if (w.balance) bits.push(w.balance);
      else if (w.resetsAt) bits.push(`resets ${formatLocal(w.resetsAt)}`);
      items.push({ label: `$(graph) ${id} · ${w.label}`, description: bits.join(' · '), detail });
    }
    for (const c of counters(provider)) {
      if (c.kind === 'credits') {
        items.push({ label: `$(coin) ${id} · credits`, description: c.value, detail });
      } else {
        items.push({
          label: `$(tag) ${id} · reset credits`,
          description: `${c.value} available`,
          detail: c.list.filter(x => !x.status || x.status === 'available').slice(0, 4)
            .map(x => `${x.title || 'reset'} — expires ${formatLocal(x.expires_at)} (${countdown(x.expires_at)})`)
            .join(' · ') || detail
        });
      }
    }
  }
  if (!items.length) {
    items.push({ label: '$(info) no providers enabled in CodexBar', description: '', detail: 'enable providers in the CodexBar app' });
  }
  items[0].buttons = [REFRESH_BUTTON, PIN_BUTTON];
  items.push({ label: '$(gear) Settings', description: '', detail: 'codexbarUsage.*', action: 'settings' });

  const picked = await vscode.window.showQuickPick(items, {
    title: `CodexBar @ ${snapshot.host} — updated ${snapshot.at.toLocaleTimeString()}`,
    matchOnDetail: true,
    ignoreFocusOut: true
  });
  if (!picked) return;
  if (picked.action === 'settings') return openSettings();
  if (picked.button === REFRESH_BUTTON) return refresh();
  if (picked.button === PIN_BUTTON) return toggleExpanded();
}

function openSettings() {
  vscode.commands.executeCommand('workbench.action.openSettings', SECTION);
}

function activate(context) {
  channel = vscode.window.createOutputChannel('CodexBar');
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.name = 'CodexBar Usage';
  statusItem.command = 'codexbarUsage.showDetails';
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
  _internals: {
    statusText, detailCard, windows, limitingWindow, providerValue, counters,
    severity, shortLabel, money, formatLocal, countdown
  }
};
