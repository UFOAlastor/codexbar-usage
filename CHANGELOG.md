# Changelog

## 0.2.0

- Adaptive refresh cadence aligned with CodexBar's own behaviour, plus `fixed` / `off` modes.
- Refresh on window focus (throttled to once a minute).
- Reset-credit and credit counters are now opt-in settings (off by default).
- Warning / error colours on the status bar at `warnThreshold` / `errorThreshold`.
- Click opens a menu (refresh, details, settings) instead of refreshing blindly.
- Output channel `CodexBar` for diagnostics; errors surfaced in the tooltip.
- Packaged project, README, changelog and `vsce` build script.

## 0.1.0

- First version: status bar with Codex weekly usage, reset-credit count and DeepSeek balance, read from the `codexbar` CLI on the workspace host.
