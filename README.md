# CodexBar Usage

[![VS Marketplace](https://img.shields.io/visual-studio-marketplace/v/ZanderAlastor.codexbar-usage)](https://marketplace.visualstudio.com/items?itemName=ZanderAlastor.codexbar-usage)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Every quota [CodexBar](https://codexbar.app) tracks — Codex, Claude, Gemini, Cursor, DeepSeek, Tavily, and the rest of its provider list — in the VS Code status bar. The extension reads the `codexbar` CLI, and because it is a *workspace* extension it reads it **on the machine that owns the workspace**: over Remote-SSH that is your home machine, not the laptop you are typing on.

Nothing is hardcoded to a particular vendor. By default the extension asks CodexBar for **whatever providers you have enabled in the app** (`codexbar usage` without `--provider`), so switching a provider on in CodexBar is all it takes for it to show up here.

## What you see

```
$(pulse) Codex 96% left · DS ¥77.60
```

<img alt="" src="images/icon.png" width="0" height="0">

- One segment per provider, **ranked by how close it is to running out**, capped at `statusBarLimit` (default 3).
- Percentage providers show the remaining share of their most-consumed window; balance providers (DeepSeek ¥, Tavily credits …) show the amount instead.
- Colours: warning at `warnThreshold` (80 % used), error at `errorThreshold` (95 %).
- A `~` before a number means the last fetch failed and that value is the last good reading.

### Click = detail dialog

Clicking opens a compact list — one row per provider window, plus credits and reset credits:

| Row | Shows |
| --- | --- |
| `<provider> · <window>` | used / left / reset countdown, account, last update |
| `<provider> · reset credits` | every banked reset credit with expiry and countdown |
| `<provider> · credits` | remaining credits |
| `Settings` | jump straight to the settings |

The first row carries a **refresh** button. There is no pin/expand mode: the status bar stays one line, and the dialog is where the detail lives.

### Hover = detail card

Hovering shows a small card anchored right above the item (the only popover VS Code allows for a status bar item). It lists **every enabled provider**: account, plan, each window with used/left/countdown/reset timestamp, extra-usage allowance, credits, every reset credit with expiry, plus source, data confidence and the codexbar version. The card also carries clickable `Refresh` / `Settings` links, so refreshing lives inside the detail view rather than on the item itself.

### Resilience

A failed fetch never blanks the item: the extension retries once, falls back to the local Codex CLI source where that makes sense, and then keeps the **last good reading** marked `~`, with the age of that reading and the failure reason in the card.

### CodexBar stays the single source of truth

With `inheritCodexBar` on (default) the extension reads CodexBar's **own** configuration instead of asking you to configure things twice:

| Read from | Used for |
| --- | --- |
| `~/.config/codexbar/config.json` → `providers[].enabled` | which providers exist at all (the CLI is also asked for the enabled set) |
| CodexBar defaults → `refreshFrequency` | a fixed cadence set in the app is honoured instead of the adaptive one |
| CodexBar defaults → `menuBarShowsHighestUsage` / `providersSortedAlphabetically` | segment order in the status bar (`sortOrder: codexbar`) |
| CodexBar defaults → `hidePersonalInfo` | masks account e-mails in the hover card and the dialog |

### Languages

English by default, Simplified Chinese when VS Code runs in Chinese. Two layers:

- `package.nls.json` / `package.nls.zh-cn.json` — command titles, setting names, descriptions, enum labels (manifest strings).
- `l10n/bundle.l10n.json` / `l10n/bundle.l10n.zh-cn.json` — everything at runtime through `vscode.l10n.t()`: the status-bar wording (`剩 95%`), the hover card, and every row of the detail dialog (`重置券`, `可用 2 张`, `更新于 …`, `每周`, `余额`).

Nothing to configure; VS Code picks the bundle from its display language.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `codexbarUsage.executable` | `codexbar` | CLI name or absolute path, resolved on the workspace host. |
| `codexbarUsage.extraPath` | `["/opt/homebrew/bin","/usr/local/bin"]` | Extra PATH entries (Homebrew is often absent from the extension-host PATH). |
| `codexbarUsage.providers` | `[]` | Empty = follow CodexBar's own enabled providers. Fill in ids (`codex`, `claude`, `gemini`, …) to force a set. |
| `codexbarUsage.inheritCodexBar` | `true` | Read CodexBar's config/defaults for providers, cadence, sort order and personal-info masking. |
| `codexbarUsage.sortOrder` | `codexbar` | `codexbar` (follow the app), `usage` (most consumed first) or `alphabetical`. |
| `codexbarUsage.hiddenProviders` | `[]` | Provider ids to keep out of the status bar / detail views. |
| `codexbarUsage.statusBarLimit` | `3` | Providers shown in the status bar (most constrained first). |
| `codexbarUsage.metric` | `remaining` | `remaining` or `used`. |
| `codexbarUsage.showCounters` | `false` | Also append credits / reset credits to the status-bar item. |
| `codexbarUsage.refreshMode` | `adaptive` | `adaptive` · `fixed` · `off`. |
| `codexbarUsage.refreshMinutes` | `10` | Interval used when `refreshMode` is `fixed`. |
| `codexbarUsage.refreshOnFocus` | `true` | Refresh when the window regains focus (max once a minute). |
| `codexbarUsage.warnThreshold` | `80` | Used % that switches the item to the warning colour. |
| `codexbarUsage.errorThreshold` | `95` | Used % that switches the item to the error colour. |

### Refresh cadence

CodexBar itself ships with `refreshFrequency = adaptive` and refreshes when its menu opens; this extension mirrors that instead of inventing a fixed poll.

| Situation | Poll interval |
| --- | --- |
| fresh / idle | 10 min |
| worst provider ≥ `warnThreshold` | 3 min |
| worst provider ≥ `errorThreshold` | 1 min |
| any provider erroring | 5 min |
| window regains focus | immediately (max once a minute) |

## Commands

| Command | Purpose |
| --- | --- |
| `CodexBar: Show usage details` | Detail dialog (default click action). |
| `CodexBar: Refresh usage` | Fetch now. |
| `CodexBar: Open settings` | Jump to this extension's settings. |

## Requirements

- `codexbar` installed and signed in **on the machine where the workspace lives** (Apple Silicon Homebrew: `/opt/homebrew/bin/codexbar`).
- Providers must be enabled in the CodexBar app — the extension displays what CodexBar reports, it never asks for credentials of its own.

Sanity check on that host:

```bash
codexbar usage --format json                        # the providers you enabled
codexbar usage --provider codex --format json       # one provider
```

## Development

```bash
node --check src/extension.js
node scripts/dev-test.js                       # activate() against the real CLI, stub VS Code API
node scripts/dev-test.js --stale               # adds a failure injection pass
TEST_PROVIDERS=tavily,codex node scripts/dev-test.js
npx @vscode/vsce package
```

`scripts/dev-test.js` prints the collapsed item, the pinned item, the hover card and the dialog rows, so rendering can be checked without launching VS Code.

### Installing a local build on a remote extension host

```bash
unzip -oq codexbar-usage-<version>.vsix -d /tmp/vsix
mkdir -p ~/.vscode-server/extensions/ZanderAlastor.codexbar-usage-<version>
cp -R /tmp/vsix/extension/. ~/.vscode-server/extensions/ZanderAlastor.codexbar-usage-<version>/
# Reload Window
```

## Publishing

See [PUBLISHING.md](PUBLISHING.md).

```bash
export VSCE_PAT="$(tr -d '\r\n' < ~/.vsce-pat)"   # PAT is never committed
npx @vscode/vsce publish minor
unset VSCE_PAT
```

## Notes and limits

- Data comes from CodexBar's own CLI output; the extension stores nothing locally and talks to no other service.
- Providers without data are skipped silently; failures are surfaced in the card and dialog but never replace good numbers with an error glyph.
- `--provider all` is deliberately avoided: it returns ~110 entries and makes unconfigured providers attempt network/cookie reads (slow, dozens of error rows). Asking for the enabled set takes ~3 s instead.

## License

MIT © Zander Alastor
