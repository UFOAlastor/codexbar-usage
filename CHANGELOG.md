# Changelog

## 0.6.1

- A missing executable (`execFile` error code `ENOENT`) stops retries, polling and focus refreshes. Click the status bar or use the hover card's Refresh command to detect it again; extension setting changes also re-detect. Normal automatic refresh resumes when the executable is available, respecting the configured refresh mode.
- Explicit provider lists are deduplicated and fetched sequentially, stopping at the first missing executable instead of launching/retrying it for every provider. Successful and last-good readings are retained.
- Network, permission, timeout, malformed JSON and provider-reported errors keep their existing retry/fallback and stale-data behavior. Error text mentioning ENOENT does not pause refreshes.
- The empty failure status now reads `codexbar ✗`, without a provider count. The hover card explains paused detection in English and Simplified Chinese.
- Concurrent refreshes share a request; setting changes discard obsolete results and queue the newest configuration. Pending timers are cancelled on refresh/deactivation, and late callbacks cannot restart polling.

## 0.6.0

- **Removed the pin / expand mode** — it duplicated what the hover card and the click dialog already show. The status bar stays one line; the `codexbarUsage.toggle` command is gone.
- `showCounters` now appends credits / reset credits to the status-bar item itself (previously it only worked in the expanded state).
- The dialog's first row carries just the refresh button; the hover card links only `Refresh` and `Settings`.

## 0.5.0

- **Settings no longer Codex/DeepSeek-centric.** `inheritCodexBar` (default on) reads CodexBar's own config and defaults: enabled providers, `refreshFrequency`, menu-bar sort preference (`menuBarShowsHighestUsage` / `providersSortedAlphabetically`) and `hidePersonalInfo`.
- New `sortOrder` (`codexbar` / `usage` / `alphabetical`) and `hiddenProviders` settings.
- **Runtime localisation** through `vscode.l10n.t()` with `l10n/bundle.l10n.json` + `l10n/bundle.l10n.zh-cn.json`: status-bar wording, hover card and the whole click dialog are Chinese when VS Code is Chinese (window labels such as `Weekly` → `每周`, `Balance` → `余额` included).
- `dev-test.js` accepts `TEST_LOCALE=zh-cn` to render the real translation bundle headless.
- Balance windows are detected from the untranslated label, so a translated `余额` row no longer renders as `0% / 100%`.

## 0.4.0

- **All CodexBar providers**, not just Codex and DeepSeek: the extension asks CodexBar for its enabled providers (`codexbar usage` with no `--provider`) and renders them generically — windows, balances, credits and reset credits all derive from the CLI payload.
- New `codexbarUsage.providers` override (empty = follow CodexBar's toggles) and `codexbarUsage.statusBarLimit` (default 3, most constrained first).
- `codexbarUsage.metric` replaces `codexMetric` (`remaining` / `used`; the old key is still honoured) and `codexbarUsage.showCounters` replaces the two Codex-specific counter toggles.
- Providers are ranked by consumption, colours follow the worst provider, and stale markers work per provider.
- Deliberately avoids `--provider all` (≈110 entries, unconfigured providers hit the network, ~30 s); the enabled call takes ~3 s.
- Docs, settings copy (EN + zh-CN) and `dev-test.js` updated; `TEST_PROVIDERS` lets the test force a provider set.

## 0.3.1

- Clicking the item now opens a **detail dialog** (quick-pick list with refresh and pin buttons); in-place expansion moved to the pin button / `Toggle pinned details`.
- Resilient refresh: one retry, Codex web → CLI source fallback, and last-good data kept with a `~` stale marker instead of an error glyph.
- Settings, commands and descriptions localised through `package.nls.json` / `package.nls.zh-cn.json` (English default, Chinese when VS Code runs in Chinese).

## 0.3.0

- Clicking the item now **expands details in place** in the status bar (reset countdown, credits, reset-credit expiry) instead of firing a refresh; the refresh action moved into the detail view.
- Detail card rewritten: per-window used/left/countdown/reset time, extra-usage allowance, every banked reset credit with expiry, data confidence and codexbar version.
- Detail card exposes clickable `Refresh` / `Settings` / `Pin` commands.
- New `codexbarUsage.toggle` command; quick-pick summary now offers refresh, pin and settings.
- Publisher set to `ZanderAlastor`; marketplace-facing README, publishing guide and icon polished.

## 0.2.0

- Remaining-share display by default, with `codexbarUsage.codexMetric` to switch to used.
- Adaptive refresh cadence aligned with CodexBar's own setting, plus `fixed` / `off` modes.
- Refresh on window focus (throttled to once a minute).
- Reset-credit and credit counters opt-in, default off.
- Warning / error colours on the status bar.
- Output channel for diagnostics; packaged vsce build, README, changelog, icon.

## 0.1.0

- First version: status bar with Codex weekly usage, reset-credit count and DeepSeek balance from the `codexbar` CLI on the workspace host.
