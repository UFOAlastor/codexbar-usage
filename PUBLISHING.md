# Publishing CodexBar Usage

Everything here runs on the machine that owns the repository
(`/Volumes/SSD/Code/codexbar-usage`). No secrets are stored in the repo.

## 0. Current state

- Publisher `ZanderAlastor` exists; **0.3.1 was published on 2026-10-26**.
- Repository: <https://github.com/UFOAlastor/codexbar-usage>.
- The PAT lives in the **macOS Keychain** (service `vsce-pat`, account
  `ZanderAlastor`, 1-year expiry), so later releases need no re-entry. It is never
  written into the repo and never appears in logs or chat:

  ```bash
  export VSCE_PAT="$(security find-generic-password -s vsce-pat -a ZanderAlastor -w | tr -d '\n')"
  npx @vscode/vsce publish
  unset VSCE_PAT
  ```

## 1. One-time setup

1. Sign in to <https://marketplace.visualstudio.com/manage> with the Microsoft
   account that should own the extension (Zander's own account, not a work one).
2. Create a publisher with the exact **ID `ZanderAlastor`** — the marketplace ID
   is case-sensitive and must match `publisher` in `package.json`.
3. Authorise `vsce`:

`--azure-credential` does **not** open a browser or a device-code prompt: vsce
only chains Environment / Azure CLI / Managed Identity / Azure PowerShell / azd
credentials, so without an `az login` session it silently stalls after packing.

Use a PAT instead — **never paste it into a chat or a commit**:

```bash
# owner runs this in their own terminal; input is hidden
read -rs -p "PAT: " P && printf '%s' "$P" > ~/.vsce-pat && chmod 600 ~/.vsce-pat && unset P
```

```bash
# publishing machine reads the file, never echoes it
export VSCE_PAT="$(tr -d '\r\n' < ~/.vsce-pat)"
npx @vscode/vsce publish            # or: publish patch / publish minor
unset VSCE_PAT
```

Delete the file afterwards (overwrite with random bytes, then remove). Create the
PAT at `https://dev.azure.com/<org>/_usersSettings/tokens` with scope
**Marketplace → Manage**; find your organisation at <https://aex.dev.azure.com/me>.

## 2. Pre-flight checklist

```bash
node --check src/extension.js
npm test                                     # isolated refresh regressions
node scripts/dev-test.js                     # optional: real CLI status / hover / dialog
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
# PAT from the Keychain (see section 0)
export VSCE_PAT="$(security find-generic-password -s vsce-pat -a ZanderAlastor -w | tr -d '\n')"

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
- The repository now exists, so `vsce package` no longer needs
  `--allow-missing-repository`.
- Verify a release from any machine:
  ```bash
  curl -s -X POST 'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery' \
    -H 'Content-Type: application/json' -H 'Accept: application/json;api-version=7.2-preview.1' \
    -d '{"filters":[{"criteria":[{"filterType":7,"value":"ZanderAlastor.codexbar-usage"}],"pageNumber":1,"pageSize":1}],"flags":914}'
  ```
