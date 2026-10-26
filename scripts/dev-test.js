'use strict';

/**
 * Runs the extension against the real codexbar CLI with a stubbed VS Code API and
 * prints what the status bar and detail card render.
 *
 *   node scripts/dev-test.js            # normal render (collapsed, pinned, detail card)
 *   node scripts/dev-test.js --stale    # then break the CLI and check stale fallback
 *   WAIT_MS=90000 node scripts/dev-test.js
 */

const Module = require('module');
const path = require('path');

const values = {
  'codexbarUsage.executable': process.env.TEST_EXEC || 'codexbar',
  'codexbarUsage.extraPath': ['/opt/homebrew/bin', '/usr/local/bin'],
  'codexbarUsage.providers': process.env.TEST_PROVIDERS ? process.env.TEST_PROVIDERS.split(',') : [],
  'codexbarUsage.statusBarLimit': 3,
  'codexbarUsage.metric': 'remaining',
  'codexbarUsage.showCounters': false,
  'codexbarUsage.refreshMode': 'off',
  'codexbarUsage.refreshMinutes': 10,
  'codexbarUsage.refreshOnFocus': false,
  'codexbarUsage.warnThreshold': 80,
  'codexbarUsage.errorThreshold': 95
};

const item = { text: '', tooltip: null, command: '', name: '', visible: false, show() { this.visible = true; } };
const commands = {};
let lastQuickPick = null;

const vscode = {
  StatusBarAlignment: { Left: 1, Right: 2 },
  ThemeColor: class { constructor(id) { this.id = id; } },
  ThemeIcon: class { constructor(id) { this.id = id; } },
  MarkdownString: class {
    constructor(value, supportThemeIcons) {
      this.value = value || '';
      this.isTrusted = false;
      this.supportThemeIcons = !!supportThemeIcons;
    }
    appendMarkdown(s) { this.value += s; return this; }
  },
  window: {
    createStatusBarItem: () => item,
    createOutputChannel: () => ({ appendLine: l => { if (process.env.DEBUG) console.error(l); }, dispose() {} }),
    showErrorMessage: m => console.error('ERROR:', m),
    showWarningMessage: m => console.error('WARN:', m),
    showInformationMessage: m => console.log('INFO:', m),
    showQuickPick: async items => { lastQuickPick = items; return undefined; },
    onDidChangeWindowState: () => ({ dispose() {} })
  },
  commands: {
    registerCommand: (name, fn) => { commands[name] = fn; return { dispose() {} }; },
    executeCommand: async () => {}
  },
  workspace: {
    getConfiguration: () => ({ get: k => values[`codexbarUsage.${k}`] }),
    onDidChangeConfiguration: () => ({ dispose() {} })
  }
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return vscode;
  return originalLoad.apply(this, arguments);
};

const ext = require(path.resolve(__dirname, '..', 'src', 'extension.js'));
const ctx = { subscriptions: [] };
ext.activate(ctx);

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitIdle(limitMs = Number(process.env.WAIT_MS || 90000)) {
  const started = Date.now();
  await sleep(1200);
  while (/spin/.test(item.text) && Date.now() - started < limitMs) await sleep(400);
  if (/spin/.test(item.text)) throw new Error(`timeout waiting for refresh (last: ${item.text})`);
  await sleep(300);
}

(async () => {
  await waitIdle();

  console.log('--- status bar ---');
  console.log(`collapsed : ${item.text}`);
  if (commands['codexbarUsage.toggle']) commands['codexbarUsage.toggle']();
  console.log(`pinned    : ${item.text}`);
  if (commands['codexbarUsage.toggle']) commands['codexbarUsage.toggle']();

  console.log('\n--- detail card (hover) ---');
  console.log(item.tooltip ? item.tooltip.value : '(none)');

  console.log('\n--- click dialog rows ---');
  if (commands['codexbarUsage.showDetails']) await commands['codexbarUsage.showDetails']();
  if (Array.isArray(lastQuickPick)) {
    for (const row of lastQuickPick) {
      console.log(`• ${row.label} | ${row.description || ''} | ${row.detail || ''}${row.buttons ? ' [buttons]' : ''}`);
    }
  } else {
    console.log('(quick pick not invoked)');
  }

  if (process.argv.includes('--stale')) {
    console.log('\n--- stale fallback (CLI forced to fail) ---');
    values['codexbarUsage.executable'] = 'codexbar-does-not-exist';
    await commands['codexbarUsage.refresh']();
    await waitIdle(60000);
    console.log(`collapsed : ${item.text}`);
    console.log('tooltip stale section:');
    const tip = item.tooltip ? item.tooltip.value : '';
    console.log(tip.split('\n').filter(l => /stale|error/i.test(l)).join('\n') || '(no stale marker)');
  }

  ext.deactivate();
  process.exit(0);
})().catch(err => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
