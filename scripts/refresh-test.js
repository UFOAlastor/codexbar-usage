'use strict';

// Public activation/command/event tests with isolated CLI callbacks and a fake
// clock. No VS Code settings, accounts, network or real provider calls are used.
const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../src/extension.js'), 'utf8');
const good = (provider = 'codex', usedPercent = 25) => ({
  provider, usage: { primary: { usedPercent, windowMinutes: 300 } }
});
const failure = (code, message = code) => Object.assign(new Error(message), { code });
const settle = () => new Promise(resolve => setImmediate(resolve));

function harness(overrides = {}, { realCLI = false } = {}) {
  let now = 1700000000000;
  let timerId = 0;
  let focusListener, configListener;
  const values = { inheritCodexBar: false, extraPath: ['/test/bin'], ...overrides };
  const commands = {}, calls = [], pending = [], timers = new Map();
  const errors = [], logs = [], picks = [], writes = [];
  const item = { show() {}, dispose() {} };
  Object.defineProperty(item, 'text', {
    get: () => writes.at(-1), set: value => writes.push(value)
  });
  const disposable = { dispose() {} };
  const vscode = {
    StatusBarAlignment: { Right: 2 },
    ThemeIcon: class { constructor(id) { this.id = id; } },
    ThemeColor: class { constructor(id) { this.id = id; } },
    MarkdownString: class {
      constructor() { this.value = ''; }
      appendMarkdown(text) { this.value += text; }
    },
    window: {
      createStatusBarItem: () => item,
      createOutputChannel: () => ({ appendLine: line => logs.push(line), dispose() {} }),
      showErrorMessage: message => errors.push(message),
      showWarningMessage: message => errors.push(message),
      showQuickPick: async items => { picks.push(items); },
      onDidChangeWindowState: fn => { focusListener = fn; return disposable; }
    },
    workspace: {
      getConfiguration: () => ({ get: key => values[key] }),
      onDidChangeConfiguration: fn => { configListener = fn; return disposable; }
    },
    commands: {
      registerCommand: (id, fn) => { commands[id] = fn; return disposable; },
      executeCommand: async () => {}
    }
  };
  const childProcess = {
    execFile(executable, args, options, callback) {
      const call = { executable, args: Array.from(args), options, callback };
      calls.push(call);
      if (realCLI) return require('node:child_process').execFile(executable, args, options, callback);
      pending.push(call);
    },
    execFileSync() { throw new Error('Unexpected preferences access'); }
  };
  const context = {
    module: { exports: {} }, process: { env: { PATH: '/usr/bin:/bin' } },
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } },
    setTimeout(callback, delay) {
      const id = ++timerId;
      timers.set(id, { callback, delay, at: now + delay });
      return id;
    },
    clearTimeout: id => timers.delete(id),
    require(id) {
      if (id === 'vscode') return vscode;
      if (id === 'child_process') return childProcess;
      if (id === 'os') return { homedir: () => '/test', hostname: () => 'test-host' };
      if (id === 'fs') return { readFileSync() { throw new Error('Unexpected file access'); } };
      if (id === 'path') return path;
      throw new Error(`Unexpected import: ${id}`);
    }
  };
  vm.runInNewContext(source, context, { filename: 'extension.js' });
  const extension = context.module.exports;
  extension.activate({ subscriptions: [] });
  return {
    item, values, calls, pending, timers, commands, errors, logs, picks, writes,
    stop: () => extension.deactivate(),
    focus: () => focusListener({ focused: true }),
    configure(update, relevant = true) {
      Object.assign(values, update);
      configListener({ affectsConfiguration: section => relevant && section === 'codexbarUsage' });
    },
    async reply(data = [good()], err = null, stderr = '') {
      assert.ok(pending.length, 'a CLI call must be pending');
      pending.shift().callback(err, typeof data === 'string' ? data : JSON.stringify(data), stderr);
      await settle();
    },
    async advance(ms) {
      const end = now + ms;
      for (let count = 0; count < 100; count++) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at;
        timers.delete(next[0]);
        next[1].callback();
        await settle();
      }
      now = end;
    }
  };
}

for (const providers of [[], ['codex', 'claude', 'gemini']]) {
  for (const command of ['codexbarUsage.refresh', 'codexbarUsage.showDetails']) {
    test(`missing → no focus/poll calls → ${command} recovery (${providers.length} explicit)`, async () => {
      const h = harness({ providers });
      await h.reply('', failure('ENOENT'));
      assert.equal(h.calls.length, 1, 'no retry, fallback or per-provider spawn');
      assert.equal(h.item.text, '$(pulse) codexbar ✗');
      assert.match(h.item.tooltip.value, /codexbar not found on test-host/);
      assert.equal(h.timers.size, 0);
      h.focus();
      await h.advance(60 * 60000);
      h.focus();
      assert.equal(h.calls.length, 1);
      assert.ok(h.item.tooltip.isTrusted.enabledCommands.includes('codexbarUsage.refresh'));
      assert.match(h.item.tooltip.value, /command:codexbarUsage.refresh/);
      const recovered = h.commands[command]();
      if (providers.length) {
        for (const id of providers) await h.reply(good(id));
      } else await h.reply();
      await recovered;
      assert.match(h.item.text, /Codex 75% left/);
      assert.equal(h.timers.size, 1);
      if (command === h.item.command) assert.equal(h.picks.length, 1);
      const count = h.calls.length;
      await h.advance(10 * 60000);
      assert.equal(h.calls.length, count + 1, 'polling restored');
      if (providers.length) for (const id of providers) await h.reply(good(id));
      else await h.reply();
      h.focus();
      assert.equal(h.calls.length, count + 1 + (providers.length || 1), 'focus refresh restored');
      h.stop();
    });
  }
}

test('failed manual detection runs once and remains paused', async () => {
  const h = harness({ providers: ['codex', 'claude'], refreshMode: 'fixed', refreshMinutes: 1 });
  await h.reply('', failure('ENOENT'));
  const manual = h.commands['codexbarUsage.refresh']();
  await h.reply('', failure('ENOENT'));
  await manual;
  await h.advance(20 * 60000);
  h.focus();
  assert.equal(h.calls.length, 2);
  assert.equal(h.timers.size, 0);
  h.stop();
});

test('relevant configuration re-detects; unrelated changes do not', async () => {
  const h = harness();
  await h.reply('', failure('ENOENT'));
  h.configure({}, false);
  assert.equal(h.calls.length, 1);
  h.configure({ executable: '/new/codexbar', extraPath: ['/new/bin'] });
  assert.equal(h.calls.at(-1).executable, '/new/codexbar');
  assert.equal(h.calls.at(-1).options.env.PATH, '/new/bin:/usr/bin:/bin');
  await h.reply();
  assert.equal(h.timers.size, 1);
  h.stop();
});

for (const code of ['EACCES', 'EPERM', 'ETIMEDOUT', 'ECONNRESET', 1]) {
  test(`${code} is a regular retryable error, even if stderr says ENOENT`, async () => {
    const h = harness();
    await h.reply('', failure(code), 'ENOENT: upstream cache entry not found');
    assert.equal(h.calls.length, 2);
    await h.reply('', failure(code), 'ENOENT: upstream cache entry not found');
    assert.equal(h.timers.size, 1);
    assert.equal([...h.timers.values()][0].delay, 5 * 60000);
    h.focus();
    assert.equal(h.calls.length, 3);
    await h.reply();
    assert.match(h.item.text, /Codex 75% left/);
    h.stop();
  });
}

test('provider JSON error.code ENOENT does not pause executable detection', async () => {
  const h = harness();
  await h.reply([{ provider: 'codex', error: { code: 'ENOENT', message: 'missing provider cache' } }]);
  assert.equal(h.timers.size, 1);
  assert.equal(h.item.text, '$(pulse) codexbar ✗');
  h.focus();
  assert.equal(h.calls.length, 2);
  h.stop();
});

test('malformed CLI JSON retries and keeps automatic refresh', async () => {
  const h = harness();
  await h.reply('not json');
  await h.reply('not json');
  assert.equal(h.calls.length, 2);
  assert.equal(h.timers.size, 1);
  h.stop();
});

test('explicit providers retain retries/source fallback and deduplicate ids', async () => {
  const h = harness({ providers: ['codex', 'claude', 'codex'] });
  for (let i = 0; i < 4; i++) await h.reply('', failure('ETIMEDOUT'));
  assert.deepEqual(h.calls.slice(0, 4).map(call => call.args.includes('--source')), [false, true, false, true]);
  assert.equal(h.calls.length, 5);
  await h.reply(good('claude'));
  assert.equal(h.calls.length, 5);
  assert.match(h.item.text, /Claude 75% left/);
  assert.match(h.item.tooltip.value, /ETIMEDOUT/);
  assert.equal(h.timers.size, 1);
  h.stop();
});

for (const providers of [[], ['codex', 'claude']]) {
  test(`last healthy readings survive ENOENT and regular failures (${providers.length} explicit)`, async () => {
    const h = harness({ providers });
    if (providers.length) for (const id of providers) await h.reply(good(id));
    else await h.reply([good(), good('claude')]);
    const manual = h.commands['codexbarUsage.refresh']();
    await h.reply('', failure('ENOENT'));
    await manual;
    assert.match(h.item.text, /Codex ~75% left/);
    assert.match(h.item.text, /Claude ~75% left/);
    assert.match(h.item.tooltip.value, /stale — last good reading/);
    assert.equal(h.timers.size, 0);
    const retry = h.commands['codexbarUsage.refresh']();
    const attempts = providers.length ? providers.length * 4 : 2;
    for (let i = 0; i < attempts; i++) await h.reply('', failure('EACCES'));
    await retry;
    assert.match(h.item.text, /Codex ~75% left/);
    assert.match(h.item.tooltip.value, /EACCES/);
    assert.equal(h.timers.size, 1, 'permission failure uses regular automatic policy');
    const recovery = h.commands['codexbarUsage.refresh']();
    if (providers.length) for (const id of providers) await h.reply(good(id, 40));
    else await h.reply([good('codex', 40), good('claude', 40)]);
    await recovery;
    assert.match(h.item.text, /Codex 60% left/);
    assert.doesNotMatch(h.item.text, /~/);
    h.stop();
  });
}

test('successful explicit entries survive a later missing executable', async () => {
  const h = harness({ providers: ['codex', 'claude', 'gemini'] });
  await h.reply(good());
  await h.reply('', failure('ENOENT'));
  assert.equal(h.calls.length, 2);
  assert.match(h.item.text, /Codex 75% left/);
  assert.match(h.item.tooltip.value, /\*\*claude\*\* — codexbar not found/);
  assert.match(h.item.tooltip.value, /\*\*gemini\*\* — codexbar not found/);
  assert.equal(h.timers.size, 0);
  h.stop();
});

test('manual/focus/timer concurrency shares one request and one timer', async () => {
  const h = harness();
  const first = h.commands['codexbarUsage.refresh']();
  const second = h.commands['codexbarUsage.refresh']();
  h.focus();
  assert.equal(first, second);
  assert.equal(h.calls.length, 1);
  await h.reply();
  await first;
  assert.equal(h.timers.size, 1);
  const oldTimer = [...h.timers.values()][0];
  const manual = h.commands['codexbarUsage.refresh']();
  assert.equal(h.timers.size, 0, 'manual refresh cancels pending timer immediately');
  oldTimer.callback(); // Simulate an already queued callback despite clearTimeout.
  assert.equal(h.calls.length, 2);
  await h.reply();
  await manual;
  assert.equal(h.timers.size, 1);
  oldTimer.callback();
  assert.equal(h.calls.length, 2);
  await h.advance(10 * 60000);
  h.commands['codexbarUsage.refresh']();
  h.focus();
  assert.equal(h.calls.length, 3);
  await h.reply('', failure('ENOENT'));
  oldTimer.callback();
  assert.equal(h.calls.length, 3);
  assert.equal(h.timers.size, 0);
  h.stop();
});

for (const obsoleteError of [false, true]) {
  test(`configuration during a fetch discards old ${obsoleteError ? 'ENOENT' : 'success'} and fetches only newest settings`, async () => {
    const h = harness({ providers: ['codex', 'claude'] });
    h.configure({ executable: '/intermediate' });
    h.configure({ executable: '/latest', providers: ['gemini'], extraPath: ['/latest/bin'] });
    assert.equal(h.calls.length, 1);
    await h.reply(good('codex', 99), obsoleteError ? failure('ENOENT') : null);
    assert.equal(h.calls.length, 2);
    assert.equal(h.calls[1].executable, '/latest');
    assert.ok(h.calls[1].args.includes('gemini'));
    assert.equal(h.calls[1].options.env.PATH, '/latest/bin:/usr/bin:/bin');
    assert.doesNotMatch(h.writes.join('\n'), /Codex 1% left|codexbar ✗/);
    await h.reply(good('gemini'));
    assert.match(h.item.text, /Gemini 75% left/);
    assert.equal(h.timers.size, 1);
    h.stop();
  });
}

test('configuration invalidation stops obsolete regular-error retries', async () => {
  const h = harness();
  h.configure({ executable: '/latest' });
  await h.reply('', failure('EACCES'));
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].executable, '/latest');
  await h.reply('', failure('ENOENT'));
  assert.equal(h.timers.size, 0);
  h.stop();
});

test('deactivation cancels timers and late completions cannot paint or rearm', async () => {
  const h = harness({ providers: ['codex', 'claude'] });
  h.stop();
  const before = h.item.text;
  await h.reply('', failure('EACCES'));
  assert.equal(h.calls.length, 1);
  assert.equal(h.item.text, before);
  assert.equal(h.timers.size, 0);
  await h.commands['codexbarUsage.refresh']();
  assert.equal(h.calls.length, 1);

  const idle = harness();
  await idle.reply();
  const queued = [...idle.timers.values()][0];
  idle.stop();
  assert.equal(idle.timers.size, 0);
  queued.callback();
  assert.equal(idle.calls.length, 1);
});

test('manual recovery respects refreshMode off and refreshOnFocus false', async () => {
  const h = harness({ refreshMode: 'off', refreshOnFocus: false });
  await h.reply('', failure('ENOENT'));
  const manual = h.commands[h.item.command]();
  await h.reply();
  await manual;
  h.focus();
  await h.advance(60 * 60000);
  assert.equal(h.calls.length, 2);
  assert.equal(h.timers.size, 0);
  h.stop();
});

test('real OS ENOENT → install a local fixture → click recovers without changing settings', async () => {
  const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'codexbar-usage-test-'));
  const executable = path.join(directory, 'codexbar fixture');
  const h = harness({ executable, providers: ['codex', 'claude'] }, { realCLI: true });
  try {
    const deadline = Date.now() + 5000;
    while (!h.item.tooltip && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(h.item.text, '$(pulse) codexbar ✗');
    assert.equal(h.calls.length, 1);
    assert.equal(h.timers.size, 0);
    h.focus();
    await h.advance(60 * 60000);
    assert.equal(h.calls.length, 1);
    fs.writeFileSync(executable, '#!/bin/sh\nif [ "$3" = "claude" ]; then\n  printf \'%s\\n\' \'{"provider":"claude","usage":{"primary":{"usedPercent":30}}}\'\nelse\n  printf \'%s\\n\' \'{"provider":"codex","usage":{"primary":{"usedPercent":25}}}\'\nfi\n', { mode: 0o755 });
    await h.commands[h.item.command]();
    assert.equal(h.calls.length, 3);
    assert.match(h.item.text, /Codex 75% left/);
    assert.match(h.item.text, /Claude 70% left/);
    assert.equal(h.timers.size, 1);
    assert.equal(h.picks.length, 1);
  } finally {
    h.stop();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
