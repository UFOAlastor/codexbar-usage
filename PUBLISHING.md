# Publishing CodexBar Usage

Everything here runs on the machine that owns the repository
(`/Volumes/SSD/Code/codexbar-usage`). No secrets are stored in the repo.

## 1. One-time setup

1. Sign in to <https://marketplace.visualstudio.com/manage> with the Microsoft
   account that should own the extension (Zander's own account, not a work one).
2. Create a publisher with the exact **ID `ZanderAlastor`** — the marketplace ID
   is case-sensitive and must match `publisher` in `package.json`.
3. Authorise `vsce`:

```bash
npx @vscode/vsce login ZanderAlastor          # device-code / browser flow
# or non-interactive, with a PAT scoped to Marketplace > Manage:
VSCE_PAT=*** npx @vscode/vsce publish minor --azure-credential=false
```

Prefer the interactive `--azure-credential` login: no long-lived PAT has to be
stored anywhere, and it can be run from the VS Code remote terminal directly.

## 2. Pre-flight checklist

```bash
node --check src/extension.js
node scripts/dev-test.js                     # renders collapsed / expanded / detail card
npx @vscode/vsce package                     # must succeed without warnings other than git remote
git status --short                           # clean tree
```

Check by hand:

- [ ] `package.json` version bumped and `publisher` is `ZanderAlastor`.
- [ ] `CHANGELOG.md` has an entry for the new version.
- [ ] README screenshots/GIF (optional but strongly recommended) live in `docs/` or `images/`.
- [ ] `codexbarUsage` settings table in README matches `package.json`.

## 3. Publish

```bash
npx @vscode/vsce publish patch      # 0.3.0 -> 0.3.1
npx @vscode/vsce publish minor      # 0.3.0 -> 0.4.0
npx @vscode/vsce publish 1.0.0      # explicit version
```

`vsce publish` bundles and uploads; the listing is live within a few minutes at
`https://marketplace.visualstudio.com/items?itemName=ZanderAlastor.codexbar-usage`.

## 4. Verify after publishing

```bash
npx @vscode/vsce show ZanderAlastor.codexbar-usage
```

Then in a throwaway VS Code window install from the marketplace and confirm the
status-bar item appears and the hover card renders.

## 5. Marketplace listing copy

Use these values in the publisher portal (the portal takes them from
`package.json` on first upload; adjust afterwards if needed).

- **Display name:** `CodexBar Usage`
- **Short description:** `Codex quota and DeepSeek balance in the status bar, read from the codexbar CLI of the machine the workspace runs on — remote-aware.`
- **Categories:** `Other`
- **Tags:** `codex`, `codexbar`, `openai`, `quota`, `usage`, `deepseek`, `status bar`, `remote`
- **Icon:** `images/icon.png` (128×128)
- **Repository / issues:** `https://github.com/UFOAlastor/codexbar-usage`
- **License:** MIT

### Suggested first-release announcement

> CodexBar Usage 0.3.0 — Codex 周额度与 DeepSeek 余额直接显示在 VS Code 状态栏。
> 点击就在状态栏原地展开详情（重置倒计时、额度券到期日），悬停是一张小卡片，
> 卡片里带刷新和设置。走 workspace 扩展，Remote-SSH 连家里 Mac 时显示的是那台机器的数据。
> 数据只来自本机 codexbar CLI，不上传、不落盘。

## 6. Notes

- Marketplace requires the publisher ID to exist **before** the first upload;
  `vsce publish` fails with `Publisher 'ZanderAlastor' not found` otherwise.
- Every published version must be higher than the previous one; bump
  `package.json` or pass the version to `vsce publish`.
- `--allow-missing-repository` is only needed while the GitHub remote is absent.
