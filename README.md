**English | [简体中文](https://github.com/UFOAlastor/codexbar-usage/blob/main/README.zh-CN.md)**

# CodexBar Usage

Show AI service usage, remaining quota and balances from [CodexBar](https://codexbar.app) in the VS Code status bar.

[Install from the VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=ZanderAlastor.codexbar-usage)

## Features

- Display providers reported by CodexBar, including Codex, Claude, Gemini, Cursor, DeepSeek and Tavily. Available readings depend on your CodexBar configuration and sign-in state.
- See remaining percentages or balances at a glance; choose provider order, visibility and how many appear.
- Hover for usage windows, reset times, accounts and credits when supplied by the provider. Click to refresh and open the detail list.
- Keep the last good readings after a failed fetch, marked `~`.
- Use adaptive or fixed automatic refresh, refresh on window focus, or refresh manually.
- Read usage from the workspace host, including with Remote-SSH. The interface follows VS Code's display language: English or Simplified Chinese.

Example status text: `Codex 96% left · DS ¥77.60`.

## Install

Requirements: **VS Code 1.85 or later**, plus a working `codexbar` CLI **on the machine that hosts the workspace**. Configure and sign in to your providers through CodexBar.

1. Install **CodexBar Usage** (`ZanderAlastor.codexbar-usage`) from the [Marketplace](https://marketplace.visualstudio.com/items?itemName=ZanderAlastor.codexbar-usage).
2. On the workspace host, confirm that the CLI returns your enabled providers:

   ```sh
   codexbar usage --format json
   ```

3. If VS Code cannot find the CLI, set `codexbarUsage.executable` to its absolute path, or add its directory to `codexbarUsage.extraPath`.

For **Remote-SSH**, install the extension in the connected remote host's Extensions view and make sure `codexbar` works there. Installing the CLI only on your laptop does not provide remote workspace readings.

For a local VSIX, use **Extensions → … → Install from VSIX…**. In a remote window, verify that the extension is installed on the remote host. Reload the window if VS Code requests it.

## Use

- **Hover** over the status bar item to view details and select **Refresh** or **Settings**.
- **Click** the item to fetch once and open the detail list.
- In the Command Palette, use **CodexBar: Refresh usage**, **CodexBar: Show usage details**, or **CodexBar: Open settings**.
- By default, providers follow those enabled in CodexBar. Set `codexbarUsage.providers` to a list such as `["codex", "claude"]` to choose an explicit set.

The extension uses CodexBar's provider, refresh, sorting and account-masking preferences where supported. Provider details appear only when CodexBar supplies them. Hover delay is controlled by VS Code's global settings; this extension does not change it.

### Refresh and errors

Adaptive refresh normally runs every 10 minutes, shortening to 3 or 1 minute near the warning/error thresholds. Provider errors without a retained healthy reading use a 5-minute cadence. A fixed cadence inherited from CodexBar takes precedence over adaptive timing. Focus refresh is limited to once a minute.

If the executable is missing (`ENOENT`), **automatic polling and focus refresh pause**. After fixing the CLI installation or path, click the status bar, select **Refresh**, or change an extension setting to detect it again. If it is still missing, detection stops after one launch attempt, including with multiple configured providers. Once available, automatic refresh follows your existing settings again; `refreshMode: off` keeps polling off.

Network, permission and other fetch failures retain normal retries and last-good readings. `~` means stale data; hover to see its age and failure reason. If no healthy reading is available, the item shows `codexbar ✗`.

## Settings

Search for `codexbarUsage` in VS Code Settings.

| Setting (`codexbarUsage.` prefix) | Default | Purpose |
| --- | --- | --- |
| `executable` | `codexbar` | CLI name or absolute path on the workspace host. |
| `extraPath` | `["/opt/homebrew/bin", "/usr/local/bin"]` | Extra directories used to find the CLI. |
| `providers` | `[]` | Follow CodexBar, or specify provider IDs. |
| `inheritCodexBar` | `true` | Follow supported CodexBar preferences. |
| `sortOrder` | `codexbar` | `codexbar`, `usage`, or `alphabetical`. |
| `hiddenProviders` | `[]` | Hide selected provider IDs. |
| `statusBarLimit` | `3` | Maximum providers in the status bar. |
| `metric` | `remaining` | Show `remaining` or `used` percentages. |
| `showCounters` | `false` | Also show credit/reset-credit counts in the status bar. |
| `refreshMode` | `adaptive` | `adaptive`, `fixed`, or `off` (polling only). |
| `refreshMinutes` | `10` | Polling interval in `fixed` mode. |
| `refreshOnFocus` | `true` | Refresh when the window regains focus. |
| `warnThreshold` | `80` | Used percentage for warning color. |
| `errorThreshold` | `95` | Used percentage for error color. |

## Development

```sh
npm run check
npm test
npx @vscode/vsce package
```

Tests use isolated fixtures without provider accounts or network access. For optional real-CLI inspection, run `node scripts/dev-test.js`.

[Changelog](https://github.com/UFOAlastor/codexbar-usage/blob/main/CHANGELOG.md) · [Report an issue](https://github.com/UFOAlastor/codexbar-usage/issues) · [MIT License](https://github.com/UFOAlastor/codexbar-usage/blob/main/LICENSE)
