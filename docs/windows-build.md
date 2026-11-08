# Windows x64 原生构建与测试

Windows 构建使用原生 MSVC 和未修改的官方 Git 依赖，已通过 GitHub Actions 首次编译与核心检查。Linux 远程开发时通过 GitHub 托管 Windows runner 构建，宿主机无需安装 Windows 编译工具。

## GitHub Actions

工作流为 `Build Windows`（`.github/workflows/windows-build.yml`），仅手动触发，不响应 push、PR 或 tag，也不创建 Release。首次运行前，需先将工作流和相关源码提交、推送到默认分支 `main`。

在 GitHub 的 Actions 页面选择工作流，点击 Run workflow，选择分支与产物类型：

| 选项 | 产物 |
| --- | --- |
| `exe` | 包含运行资源的免安装 ZIP |
| `nsis` | NSIS 安装包 |
| `all`（默认） | 同时生成 ZIP 与 NSIS |

也可以通过 GitHub CLI 触发：

```bash
gh workflow run windows-build.yml --ref main -f bundle=all
gh run list --workflow windows-build.yml
```

前端类型检查与测试、Rust 配置存储与核心单元测试、原生构建、exe 图标与资源校验，以及实际程序的 Direct／Process／Recovery／MissingResource 检查全部通过后，才上传正常下载包。失败时只保留已有诊断报告。Actions Artifacts 保留 14 天，包含所选产物、检查报告和记录提交、工具链、来源及 SHA-256 的 `build-info.json`。

## Windows 本机构建

在 Windows x64 上准备与工作流对应的工具链并安装前端依赖后，可以运行：

```powershell
pnpm build:windows exe
pnpm build:windows nsis
pnpm build:windows all
```

也保留 `pnpm build:windows:exe`、`pnpm build:windows:nsis`、`pnpm build:windows:all`。`pnpm build:windows --help` 查看用法。`all` 只编译一次，再导出两种形式。

| 内容 | 路径 |
| --- | --- |
| 免安装目录（exe／all 模式） | `artifacts/windows-x64/exe/` |
| 免安装 ZIP | `artifacts/windows-x64/cleartier-windows-x64.zip` |
| NSIS 安装包 | `artifacts/windows-x64/nsis/*-setup.exe` |
| 构建记录与文件 SHA-256 | `artifacts/windows-x64/build-info.json` |
| 核心检查报告 | `artifacts/windows-x64/checks/` |

构建清理旧的产物记录、ZIP 和安装包，避免失败时把旧文件误当作本次成功产物。内部检查目录位于 `.cache/windows-native/`，不进入 Git。

免安装版需完整解压，保留 `cleartier.exe` 旁的 DLL、驱动和许可证。运行文件与许可证通过 `cargo metadata --locked` 从固定版本的官方源码中提取，来源及运行文件校验值记录于 `core-resources.json`。`Packet.lib` 只参与链接，不分发；资源准备脚本不依赖仓库内的 vendor 或临时备份目录。

远程开发时，可以使用 `python3` 临时提供产物下载服务。

## Windows 上测试

直接程序需要目标机器已安装 Microsoft Edge WebView2 Runtime。它包含打包后的前端，不需要运行 Vite 或访问远程开发服务器。

阶段 2–4 源码已实现本机配置存储和真实连接管理；新产物验收见[网络配置存储](network-configuration.md)及[连接管理](connection-management.md)。此前通过验收的阶段 1 产物仍使用演示网络，不能代替本次改动的 Windows 验收。

免安装目录包含 `check-core.ps1`。在该目录打开**普通权限**的 PowerShell，按顺序执行：

```powershell
# 独立进程、本地通信与双实例管理，无 UAC、无 TUN
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\check-core.ps1

# 在 UAC 提示中选择“否”或取消
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\check-core.ps1 -Mode Cancel

# 在 UAC 提示中选择“是”，验证两个临时 TUN 的创建与清理
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\check-core.ps1 -Mode Tun

# 无 TUN，验证强制结束核心后检测异常并启动新进程
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\check-core.ps1 -Mode Recovery

# 在临时副本中故意缺少 Wintun，验证提权前报错
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\check-core.ps1 -Mode MissingResource
```

各模式显示 JSON 报告及保存路径，成功时 `passed` 为 `true`，进程退出码为 `0`；失败为 `1`，无效命令参数为 `2`。`Cancel` 和 `MissingResource` 将正确拒绝操作视为检查成功。原来的进程内七项检查仍可通过 `-Mode Direct` 运行。

默认 `Process` 模式通过 `--process-check` 入口启动控制端，再由它启动同一个 exe 的 `--core-host` 工作进程，验证身份握手、版本、双实例运行、独立停止、重新启动及核心退出。`guiPid` 和 `corePid` 应不同。检查入口不创建 WebView，也不连接已有服务器或写入保存的网络配置。报告旁的 `.files` 目录保留检查日志，便于定位失败原因。

`Tun` 模式要求控制端为普通用户，并验证 `guiElevated: false`、`coreElevated: true`。它使用随机 `ct-…` 名称创建两个临时网卡，配置 `198.18.0.1/32` 和 `198.18.0.2/32`；脚本先检查地址占用。测试会查询 Windows 网卡列表，检查停止其中一个不影响另一个，以及结束后临时网卡全部移除。核心沿用官方防火墙行为：接口规则随接口清理，应用级放行规则可能保留。无服务器的 TUN 测试不代表端到端组网已经通过。

普通界面仍使用 `asInvoker`，打开应用和查看版本不会启动核心或弹出 UAC；已开启逐网络自动连接时沿用该启动队列。阶段 7 默认关闭窗口隐藏到托盘并保持连接，明确退出才清理核心。详细结构和错误约定见[核心运行基础](core-runtime.md)；新包集中验收见[Windows 集中验收](windows-acceptance.md)。

NSIS 安装包沿用 Tauri 的默认 WebView2 检查／安装流程，缺少运行时时需要联网下载。构建流程默认导出未签名产物，安装和功能验收应在 Windows 环境进行。

## 工具链与验证记录

工具链版本和 runner 配置以 [Windows 工作流](../.github/workflows/windows-build.yml) 为准。Windows 本机构建需要 MSVC Build Tools、Windows SDK、Rust MSVC target、Node.js、pnpm、Git、protoc（包含 protobuf 标准头文件），以及 thunk-rs 使用的 curl、7zip。依赖安装使用仓库锁文件。

`scripts/windows/build.mjs` 集中处理检查、原生编译、临时资源目录、核心检查及产物导出；工作流负责准备工具链、缓存和上传。`scripts/verify-windows-icon.mjs` 校验实际 exe 中的应用图标资源。图标和应用清单变更会触发原生资源重建。

本地 vendor 和 Cargo patch 已移除，旧 Podman Windows 构建文件也已清理。当前直接引用官方 WinDivert Git 依赖。

2026-11-08，提交 `54f9625` 的 [Windows 原生 CI](https://github.com/oolongcha024/cleartier/actions/runs/42457090789) 成功：前端检查、ZIP 与 NSIS 构建、图标／资源校验和四项无交互核心检查全部通过。下载产物已核对提交、SHA-256、资源、ZIP 结构及核心报告；exe 六个尺寸的图标与仓库 ICO 一致。交互 UAC／TUN 仍保留实机验证。
