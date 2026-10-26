# CodexBar Usage

[![VS Marketplace](https://img.shields.io/visual-studio-marketplace/v/ZanderAlastor.codexbar-usage)](https://marketplace.visualstudio.com/items?itemName=ZanderAlastor.codexbar-usage)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Keep an eye on your **Codex quota** and **DeepSeek balance** without leaving the editor. The extension reads the [`codexbar`](https://codexbar.app) CLI and renders a compact status-bar item — and because it is a *workspace* extension, it reports the **machine that owns the workspace**. Over Remote-SSH that means your home Mac, not the laptop you are typing on.

## What you see

```
$(pulse) Codex 98% left · DS ¥79.86
```

- `Codex 98% left` — the **remaining** share of the weekly Codex window. Set `codexbarUsage.codexMetric` to `used` if you prefer the consumed figure. The item turns warning-coloured at 80 % used and error-coloured at 95 %.
- `DS ¥79.86` — current DeepSeek balance.
- Both parts are independent toggles; anything unavailable is skipped instead of showing a dash.

### Click = detail dialog

Clicking the item opens a compact detail dialog (a quick-pick list, not a floating window):

| Row | Shows |
| --- | --- |
| `codex · Weekly` | used / left / reset countdown, account, last update — with **refresh** and **pin** buttons |
| `codex · reset credits` | every banked reset credit with expiry and countdown |
| `codex · credits` | remaining credits |
| `deepseek · Balance` | balance and breakdown |
| `Settings` | jump straight to the settings |

Prefer the numbers always visible in the status bar itself? Use the row's **pin** button
(or `CodexBar: Toggle pinned details`) to expand the item in place:

```
$(chevron-down) Codex 98% left · ↻6d23h · 券2(3d8h) · DS ¥79.86
```

### Hover = detail card

Hovering opens a small card right above the item (the same place VS Code shows any status-bar tooltip). It contains everything the CLI exposes:

- account, plan/login method, provider source
- every rate window with `used / left / countdown / reset timestamp`
- credits remaining and extra-usage allowance
- each banked reset credit with its expiry date and countdown
- data confidence and codexbar version

The card carries its own actions, so refreshing lives *inside* the detail view:

`$(refresh) Refresh` · `$(gear) Settings` · `$(pin) Pin to status bar`

> VS Code has no API for an arbitrary floating popover anchored to the status bar. The three surfaces used here are the item itself, its tooltip (the only true anchored popover) and a quick-pick dialog for the click action.

### Resilience

If a `codexbar` call fails (web dashboard timeout, CLI missing), the extension retries once, then falls back to the local CLI source for Codex, and finally keeps the **last good reading** marked with `~` instead of blanking the item:

```
$(pulse) Codex ~98% left · DS ~¥79.86
```

The detail card and dialog say how old that reading is and why the refresh failed.

### Languages

UI strings ship with English defaults and a Simplified Chinese translation (`package.nls.json` / `package.nls.zh-cn.json`). VS Code picks the language from its own display language — nothing to configure.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `codexbarUsage.executable` | `codexbar` | CLI name or absolute path, resolved on the workspace host. |
| `codexbarUsage.extraPath` | `["/opt/homebrew/bin","/usr/local/bin"]` | Extra PATH entries (Homebrew is often absent from the extension-host PATH). |
| `codexbarUsage.showCodex` | `true` | Show the Codex section. |
| `codexbarUsage.codexMetric` | `remaining` | `remaining` or `used`. |
| `codexbarUsage.showDeepSeek` | `true` | Show the DeepSeek balance. |
| `codexbarUsage.showCredits` | `false` | Show remaining Codex credits in the collapsed item. |
| `codexbarUsage.showResetCredits` | `false` | Show the banked reset-credit count in the collapsed item. |
| `codexbarUsage.refreshMode` | `adaptive` | `adaptive` · `fixed` · `off`. |
| `codexbarUsage.refreshMinutes` | `10` | Interval used when `refreshMode` is `fixed`. |
| `codexbarUsage.refreshOnFocus` | `true` | Refresh when the window regains focus (at most once a minute). |
| `codexbarUsage.warnThreshold` | `80` | Used % that switches the item to the warning colour. |
| `codexbarUsage.errorThreshold` | `95` | Used % that switches the item to the error colour. |

### Refresh cadence

CodexBar itself ships with `refreshFrequency = adaptive` and refreshes when its menu opens; this extension mirrors that instead of inventing a fixed poll.

| Situation | Poll interval |
| --- | --- |
| fresh / idle | 10 min |
| weekly usage ≥ `warnThreshold` | 3 min |
| weekly usage ≥ `errorThreshold` | 1 min |
| any provider erroring | 5 min |
| window regains focus | immediately (max once a minute) |

Want a fixed cadence? `refreshMode: fixed` plus `refreshMinutes`. Want it strictly on demand? `refreshMode: off` and use `CodexBar: Refresh usage` below.

## Commands

| Command | Purpose |
| --- | --- |
| `CodexBar: Toggle pinned details` | Expand / collapse the status-bar item (default click action). |
| `CodexBar: Refresh usage` | Fetch now. |
| `CodexBar: Show usage details` | Quick-pick summary with refresh / pin / settings entries. |
| `CodexBar: Open settings` | Jump to this extension's settings. |

## Requirements

- `codexbar` installed and signed in **on the machine where the workspace lives**.
- Apple Silicon Homebrew installs it at `/opt/homebrew/bin/codexbar`; that directory is added to `PATH` by default.

Sanity check on the same host:

```bash
codexbar usage --provider codex --format json
codexbar usage --provider deepseek --format json
```

## Development

```bash
node --check src/extension.js
node scripts/dev-test.js            # activate() against the real CLI with a stubbed VS Code API
npx @vscode/vsce package            # -> codexbar-usage-<version>.vsix
```

`scripts/dev-test.js` prints the collapsed item, the expanded item and the detail card, so rendering can be checked without launching VS Code.

### Installing a local build on a remote extension host

```bash
unzip -oq codexbar-usage-<version>.vsix -d /tmp/vsix
mkdir -p ~/.vscode-server/extensions/ZanderAlastor.codexbar-usage-<version>
cp -R /tmp/vsix/extension/. ~/.vscode-server/extensions/ZanderAlastor.codexbar-usage-<version>/
# Reload Window
```

## Publishing

See [PUBLISHING.md](PUBLISHING.md). Short version:

```bash
export VSCE_PAT="$(tr -d '\r\n' < ~/.vsce-pat)"   # PAT is never committed
npx @vscode/vsce publish minor
unset VSCE_PAT
```

## Notes and limits

- Data comes from CodexBar's own CLI output; this extension stores nothing locally and talks to no other service.
- 5-hour and weekly windows, credits and reset credits only appear when CodexBar can read them for the signed-in plan.
- The status bar item is right-aligned with priority 100; drag it within the status bar to reposition.

## License

MIT © Zander Alastor
