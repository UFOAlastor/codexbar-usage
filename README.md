# CodexBar Usage

A VS Code extension that puts **Codex quota** and **DeepSeek balance** in the status bar, reading them from the [`codexbar`](https://codexbar.app) CLI.

Because it is a *workspace* extension (`"extensionKind": ["workspace"]`), it runs in the extension host of the machine that owns the workspace. Over **Remote-SSH** that means it reports the **remote** machine's CodexBar — no need to install anything on the client.

## What it shows

Default status bar item:

```
Codex 88% left · DS ¥80.06
```

- `Codex 88% left` — **remaining** share of the weekly Codex window (the default; switch to used with `codexbarUsage.codexMetric`). The item turns warning-coloured at 80 % used and error-coloured at 95 % used.
- `DS ¥80.06` — DeepSeek account balance.
- Optional: remaining Codex credits, the number of banked reset credits, and used-instead-of-remaining (all off by default).

Click the item for a menu: **refresh now**, **usage details**, **open settings**. Hover for a full breakdown (account, plan, window reset time, credits, reset-credit expiry).

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `codexbarUsage.executable` | `codexbar` | CLI name or absolute path, resolved on the workspace host. |
| `codexbarUsage.extraPath` | `["/opt/homebrew/bin","/usr/local/bin"]` | Extra PATH entries (Homebrew is often missing from the extension-host PATH). |
| `codexbarUsage.showCodex` | `true` | Show the Codex weekly window. |
| `codexbarUsage.codexMetric` | `remaining` | `remaining` (default) or `used`. |
| `codexbarUsage.showDeepSeek` | `true` | Show the DeepSeek balance. |
| `codexbarUsage.showCredits` | `false` | Show remaining Codex credits (hidden when zero). |
| `codexbarUsage.showResetCredits` | `false` | Show the number of banked reset credits. |
| `codexbarUsage.refreshMode` | `adaptive` | `adaptive` / `fixed` / `off`. |
| `codexbarUsage.refreshMinutes` | `10` | Interval used when `refreshMode` is `fixed`. |
| `codexbarUsage.refreshOnFocus` | `true` | Refresh when the window regains focus (throttled to once a minute). |
| `codexbarUsage.warnThreshold` | `80` | Weekly usage % that turns the item into a warning colour. |
| `codexbarUsage.errorThreshold` | `95` | Weekly usage % that turns the item into the error colour. |

### Refresh cadence

CodexBar itself refreshes adaptively (and on menu open), so `adaptive` is the default here too:

| Situation | Poll interval |
| --- | --- |
| fresh / idle | 10 min |
| weekly usage ≥ `warnThreshold` | 3 min |
| weekly usage ≥ `errorThreshold` | 1 min |
| any provider erroring | 5 min |
| window regains focus | immediately (max once a minute) |

Prefer a fixed cadence? Set `refreshMode: fixed` and pick `refreshMinutes`. Want it purely on demand? `refreshMode: off` and use the item / `CodexBar: Refresh usage`.

## Requirements

- `codexbar` installed and logged in **on the machine where the workspace lives**.
- On Apple Silicon Homebrew installs it to `/opt/homebrew/bin`; the extension adds that to `PATH` by default.

Verify from the same host:

```bash
codexbar usage --provider codex --format json
codexbar usage --provider deepseek --format json
```

## Development

```bash
node --check src/extension.js
node scripts/dev-test.js          # runs activate() against the real CLI with a stub vscode API
npx @vscode/vsce package --allow-missing-repository
```

`scripts/dev-test.js` prints the rendered status-bar text and tooltip, so behaviour can be verified without launching VS Code.

## Install the packaged build

```bash
unzip -oq codexbar-usage-<version>.vsix -d /tmp/vsix
cp -R /tmp/vsix/extension/. ~/.vscode-server/extensions/<publisher>.codexbar-usage-<version>/
# then Reload Window
```

Adding the folder to `~/.vscode-server/extensions/extensions.json` is optional — VS Code rescans the directory on start.

## Publishing

```bash
npx @vscode/vsce login <publisher>        # or: vsce publish --azure-credential
npx @vscode/vsce publish minor --azure-credential
```

Uploading requires a publisher in the Marketplace (created once, via the Azure DevOps organisation bound to the account) and the extension's `publisher` field must match its name.
