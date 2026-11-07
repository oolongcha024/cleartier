# 使用 Podman 构建 Windows x64

在 Linux x64 Podman 主机上交叉编译，编译工具和系统开发库全部放在容器中。宿主机只需 Podman；通过项目命令启动时还需现有 Node.js 和 pnpm。

## 选择产物

在仓库根目录运行：

```bash
# 只输出直接运行的程序
pnpm build:windows exe

# 只输出 NSIS 安装包
pnpm build:windows nsis

# 同时输出两种形式，也是默认选项
pnpm build:windows all
```

也可使用 `pnpm build:windows:exe`、`pnpm build:windows:nsis`、`pnpm build:windows:all`。`pnpm build:windows --help` 查看用法。

| 产物 | 路径 |
| --- | --- |
| 直接运行的程序 | `artifacts/windows-x64/exe/cleartier.exe` |
| NSIS 安装包 | `artifacts/windows-x64/nsis/*-setup.exe` |
| 本次产物信息和 SHA-256 | `artifacts/windows-x64/build-info.json` |

`all` 只编译一次，然后导出程序和安装包。`nsis` 也需要先编译应用，但只向产物目录导出安装包。非本次所选类型的旧产物保留；`build-info.json` 仅列出本次成功生成的文件。

远程开发时，可以使用 `python3` 临时提供产物下载服务。

## Windows 上测试

直接程序需要目标机器已安装 Microsoft Edge WebView2 Runtime。它包含打包后的前端，不需要运行 Vite 或访问远程开发服务器。

NSIS 安装包沿用 Tauri 的默认 WebView2 检查／安装流程，缺少运行时时需要联网下载。构建流程默认导出未签名产物，安装和功能验收应在 Windows 环境进行。

## 工具链与缓存

工具链和版本以 [Containerfile](../containers/windows/Containerfile) 为准。基础镜像固定摘要，npm 与 Cargo 使用仓库锁文件。

NSIS 必须包含 Tauri 安装模板依赖的 `Win/RestartManager.nsh`，镜像构建时会检查该文件。

首次构建会拉取镜像、安装容器内工具、下载 Windows SDK/CRT 和项目依赖。后续复用镜像层与 `.cache/windows-builder/` 下的缓存；容器中的 `node_modules`、`dist` 和 Rust target 与宿主机的同名目录分开存放。运行采用 `--userns=keep-id`，产物归当前用户所有。

构建容器默认使用宿主网络，可通过 `CLEARTIER_WINDOWS_NETWORK` 调整网络模式，例如 `CLEARTIER_WINDOWS_NETWORK=pasta pnpm build:windows all`。

重建镜像时脚本会自动检查 Containerfile 层缓存。需要更新工具链时，修改 Containerfile 中相应版本／摘要。缓存与产物均已加入 `.gitignore`。

本流程生成 `x86_64-pc-windows-msvc` 程序和 NSIS 包，不生成 MSI。方案依据：[Tauri Linux/macOS → Windows 构建文档](https://v2.tauri.app/distribute/windows-installer/#build-windows-apps-on-linux-and-macos)、[cargo-xwin](https://github.com/rust-cross/cargo-xwin)。

