**[English](https://github.com/UFOAlastor/codexbar-usage/blob/main/README.md) | 简体中文**

# CodexBar Usage

在 VS Code 状态栏查看 [CodexBar](https://codexbar.app) 提供的 AI 服务用量、剩余额度和余额。

[从 VS Code 扩展市场安装](https://marketplace.visualstudio.com/items?itemName=ZanderAlastor.codexbar-usage)

## 功能

- 显示 CodexBar 返回的平台数据，例如 Codex、Claude、Gemini、Cursor、DeepSeek 和 Tavily。实际可用数据取决于 CodexBar 配置与登录状态。
- 直接查看剩余百分比或余额，可调整平台排序、可见性和显示数量。
- 悬浮查看平台提供的用量窗口、重置时间、账号和额度券；点击刷新并打开详情列表。
- 获取失败时保留上次成功读数，以 `~` 标记旧数据。
- 支持自适应刷新、固定间隔刷新、窗口重新获得焦点时刷新及手动刷新。
- 从工作区所在机器读取数据，支持 Remote-SSH。界面随 VS Code 显示语言切换为英文或简体中文。

状态栏文字示例：`Codex 剩 96% · DS ¥77.60`。

## 安装

需要 **VS Code 1.85 或更新版本**，并在**工作区所在机器**安装可正常运行的 `codexbar` CLI。平台配置与登录在 CodexBar 中完成。

1. 在[扩展市场](https://marketplace.visualstudio.com/items?itemName=ZanderAlastor.codexbar-usage)安装 **CodexBar Usage**（扩展 ID：`ZanderAlastor.codexbar-usage`）。
2. 在工作区所在机器执行以下命令，确认能获取已启用平台的数据：

   ```sh
   codexbar usage --format json
   ```

3. 如果 VS Code 找不到 CLI，将 `codexbarUsage.executable` 设置为可执行文件的绝对路径，或将其目录加入 `codexbarUsage.extraPath`。

使用 **Remote-SSH** 时，在连接后的扩展视图中将本扩展安装到远程主机，并确认 `codexbar` 能在远程主机上运行。仅在笔记本上安装 CLI 无法提供远程工作区的数据。

安装本地 VSIX 时，使用**扩展 → … → 从 VSIX 安装…**。在远程窗口中，请确认扩展已安装到远程主机；若 VS Code 提示重载窗口，按提示操作。

## 使用

- **悬浮状态栏条目**查看详情，点击卡片内的**刷新**或**设置**。
- **点击状态栏条目**，执行一次刷新并打开详情列表。
- 在命令面板中使用 **CodexBar** 的刷新用量、显示用量详情或打开设置命令；英文名称分别为 **CodexBar: Refresh usage**、**CodexBar: Show usage details**、**CodexBar: Open settings**。
- 默认跟随 CodexBar 已启用的平台。可将 `codexbarUsage.providers` 设置为 `["codex", "claude"]` 这样的列表，指定要读取的平台。

扩展会在支持的情况下跟随 CodexBar 的平台、刷新、排序和账号隐藏偏好。详情仅展示 CodexBar 实际提供的数据。悬浮延迟由 VS Code 全局设置控制，本扩展不会修改它。

### 刷新与错误处理

自适应刷新通常每 10 分钟执行一次，接近警告或错误阈值时缩短为 3 分钟或 1 分钟。平台出错且没有保留的健康读数时，使用 5 分钟间隔。从 CodexBar 继承的固定刷新间隔优先于自适应间隔。焦点刷新最多每分钟一次。

如果缺少可执行文件（`ENOENT`），**暂停自动轮询和焦点刷新**。修复安装或路径后，点击状态栏、使用**刷新**命令，或修改扩展设置，即可重新检测。若文件仍缺失，检测只尝试启动一次；即使配置多个平台也不会逐一重复启动。可执行文件恢复后，自动刷新按原设置运行；`refreshMode: off` 仍关闭轮询。

网络、权限等其他获取错误保留常规重试及上次成功读数。`~` 表示旧数据，悬浮可查看读数时间与失败原因。没有健康读数可显示时，状态栏显示 `codexbar ✗`。

## 设置

在 VS Code 设置中搜索 `codexbarUsage`。

| 设置（统一加 `codexbarUsage.` 前缀） | 默认值 | 用途 |
| --- | --- | --- |
| `executable` | `codexbar` | 工作区主机上的 CLI 名称或绝对路径。 |
| `extraPath` | `["/opt/homebrew/bin", "/usr/local/bin"]` | 用于查找 CLI 的额外目录。 |
| `providers` | `[]` | 跟随 CodexBar，或指定平台 ID。 |
| `inheritCodexBar` | `true` | 跟随支持的 CodexBar 偏好。 |
| `sortOrder` | `codexbar` | `codexbar`、`usage`（用量）或 `alphabetical`（字母序）。 |
| `hiddenProviders` | `[]` | 隐藏指定平台。 |
| `statusBarLimit` | `3` | 状态栏最多显示的平台数量。 |
| `metric` | `remaining` | 显示 `remaining`（剩余）或 `used`（已用）百分比。 |
| `showCounters` | `false` | 在状态栏额外显示 credits／重置券数量。 |
| `refreshMode` | `adaptive` | `adaptive`（自适应）、`fixed`（固定）或 `off`（仅关闭轮询）。 |
| `refreshMinutes` | `10` | 固定模式的轮询间隔，单位为分钟。 |
| `refreshOnFocus` | `true` | 窗口重新获得焦点时刷新。 |
| `warnThreshold` | `80` | 触发警告颜色的已用百分比。 |
| `errorThreshold` | `95` | 触发错误颜色的已用百分比。 |

## 开发

```sh
npm run check
npm test
npx @vscode/vsce package
```

测试使用隔离数据，不访问平台账号或网络。如需通过真实 CLI 检查显示内容，可选运行 `node scripts/dev-test.js`。

[更新记录](https://github.com/UFOAlastor/codexbar-usage/blob/main/CHANGELOG.md) · [反馈问题](https://github.com/UFOAlastor/codexbar-usage/issues) · [MIT 许可证](https://github.com/UFOAlastor/codexbar-usage/blob/main/LICENSE)
