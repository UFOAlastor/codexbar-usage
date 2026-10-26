'use strict';

/**
 * Runs the extension's activate() against the real codexbar CLI with a stub
 * `vscode` module, then prints what the status bar and tooltip would render.
 *
 *   node scripts/dev-test.js [--fast]
 *
 * --fast skips the DeepSeek provider (used for quick parse checks).
 */

const Module = require('module');
const path = require('path');

const values = {
  'codexbarUsage.executable': 'codexbar',
  'codexbarUsage.extraPath': ['/opt/homebrew/bin', '/usr/local/bin'],
  'codexbarUsage.showCodex': true,
  'codexbarUsage.codexMetric': 'remaining',
  'codexbarUsage.showDeepSeek': true,
  'codexbarUsage.showCredits': false,
  'codexbarUsage.showResetCredits': false,
  'codexbarUsage.refreshMode': 'off',
  'codexbarUsage.refreshMinutes': 10,
  'codexbarUsage.refreshOnFocus': false,
  'codexbarUsage.warnThreshold': 80,
  'codexbarUsage.errorThreshold': 95
};

const item = { text: '', tooltip: null, command: '', name: '', visible: false, show() { this.visible = true; } };
let saved = '';

const vscode = {
  StatusBarAlignment: { Left: 1, Right: 2 },
  ThemeColor: class { constructor(id) { this.id = id; } },
  MarkdownString: class { constructor() { this.value = ''; } appendMarkdown(s) { this.value += s; return this; } },
  window: {
    createStatusBarItem: () => item,
    createOutputChannel: () => ({ appendLine: l => { if (process.env.DEBUG) console.error(l); }, dispose() {} }),
    showErrorMessage: m => console.error('ERROR:', m),
    showWarningMessage: m => console.error('WARN:', m),
    showInformationMessage: m => console.log('INFO:', m),
    showQuickPick: async () => undefined,
    onDidChangeWindowState: () => ({ dispose() {} })
  },
  commands: { registerCommand: () => ({ dispose() {} }), executeCommand: async () => {} },
  workspace: {
    getConfiguration: () => ({ get: k => values[k] }),
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

const waitMs = Number(process.env.WAIT_MS || 60000);
const started = Date.now();
const tick = setInterval(() => {
  const busy = /spin/.test(item.text);
  if (!busy && Date.now() - started > 1500) {
    clearInterval(tick);
    console.log(`status bar : ${item.text}`);
    console.log(`severity   : ${ext._internals.severity ? 'n/a' : 'n/a'}`);
    console.log('--- tooltip ---');
    console.log(item.tooltip ? item.tooltip.value : '(none)');
    ext.deactivate();
    process.exit(0);
  }
  if (Date.now() - started > waitMs) {
    clearInterval(tick);
    console.error(`TIMEOUT after ${waitMs}ms, last text: ${item.text}`);
    process.exit(1);
  }
}, 500);
