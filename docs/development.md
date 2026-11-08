# 开发指南

## 环境与启动

Node.js 与 pnpm 要求见 [package.json](../package.json)，Rust 与原生构建依赖以 [CI 工作流](../.github/workflows/check.yml)为准。桌面调试还需 [Tauri 系统依赖](https://v2.tauri.app/start/prerequisites/)、图形环境、protoc 和 libclang；浏览器预览无需桌面开发库。

```sh
pnpm install --frozen-lockfile
pnpm dev
```

开发服务及热更新使用 `http://10.126.179.2:5173`。独立浏览器入口不调用真实核心，原生能力通过适配层隔离。

| 命令 | 用途 |
| --- | --- |
| `pnpm tauri dev` | 原生桌面调试；会启动前端服务，先停止独立运行的 `pnpm dev` |
| `pnpm build` | 版本校验、类型检查及前端构建 |
| `pnpm preview` | 在 `http://10.126.179.2:4174` 预览已有前端产物 |
| `pnpm tauri build` | 本机桌面构建 |
| `pnpm theme:generate` | 修改 `src/theme/palettes.ts` 后生成主题令牌 |
| `pnpm icons:generate` | 修改标志或品牌配色后生成网页、桌面图标 |

主题与图标生成结果随代码提交，普通构建不需要重新生成。开发端口被占用时先检查已有服务，不修改远程访问地址。

## 自动化检查

在仓库根目录执行：

```sh
pnpm test
pnpm typecheck
pnpm build
cargo fmt --manifest-path src-tauri/Cargo.toml --all --check
cargo check --locked --manifest-path src-tauri/Cargo.toml --workspace
cargo test --locked --manifest-path src-tauri/Cargo.toml -p cleartier-config -p cleartier-core
```

浏览器回归先安装 CI 对应的 runner，再执行：

```sh
npm install --global agent-browser@0.38.0
agent-browser install
pnpm test:browser
```

可追加场景名，例如 `pnpm test:browser network-editor-session desktop-lifecycle`。脚本自动启动或复用开发服务、隔离浏览器会话并清理；失败截图在 `.cache/browser/`。`BROWSER_WIDTH / BROWSER_HEIGHT / BROWSER_COLOR_SCHEME / BROWSER_REDUCED_MOTION` 用于最小窗口、深色及减少动态效果检查。测试覆盖边界和实机步骤见[测试与验收](testing.md)。

## Windows 构建

Windows x64 本机需要 MSVC、Windows SDK、Rust MSVC target、Git 和 protoc 等工具，具体版本及环境设置以 [Windows 工作流](../.github/workflows/windows-build.yml)为准：

```sh
pnpm build:windows all
```

参数可选 `exe`、`nsis`、`all`，其中 `exe` 导出完整免安装 ZIP。Linux 远程开发使用手动触发的 GitHub Actions，无需在宿主机安装 Windows 工具链：

```sh
gh workflow run windows-build.yml --ref main -f bundle=all
gh run list --workflow windows-build.yml
```

工作流仅手动触发，产物通过 Actions Artifacts 提供，不自动创建 Release。正常产物须通过测试、原生编译、图标／资源校验及打包程序检查；Artifacts 保留期限以工作流为准。

| 内容 | 本机构建位置 |
| --- | --- |
| 免安装目录／ZIP | `artifacts/windows-x64/exe/`、`artifacts/windows-x64/cleartier-windows-x64.zip` |
| NSIS 安装包 | `artifacts/windows-x64/nsis/` |
| 版本、来源、工具链及 SHA-256 | `artifacts/windows-x64/build-info.json` |
| 检查报告与失败诊断 | `artifacts/windows-x64/checks/` |

构建入口为 [scripts/windows/build.mjs](../scripts/windows/build.mjs)。先查看检查报告和工具链错误，避免用旧包替代失败构建；交付时核对 `build-info.json` 的提交及校验值。

## 版本管理

应用版本以 `package.json.version` 为准，由 [版本脚本](../scripts/version.mjs)同步 Rust 应用包及其锁文件；内部 crate 和 EasyTier 核心版本独立。开发与构建只校验，不自动升版。

| 命令 | 作用 |
| --- | --- |
| `pnpm version:start minor alpha --dry-run` | 预览下一基础版本的 `alpha.1` |
| `pnpm version:start patch` | 基础补丁号加一，默认从 `alpha.1` 开始；也支持 `minor / major` 及指定阶段 |
| `pnpm version:next` | 当前预发布序号加一，如 `rc.1 → rc.2` |
| `pnpm version:promote beta` | 推进到更晚阶段，也可指定 `rc / stable`；新阶段从 `.1` 开始 |
| `pnpm version:set 0.2.0-beta.1` | 显式设置严格更高的版本 |
| `pnpm version:check` | 检查格式、Rust 同步及 Tauri 版本引用 |

版本格式为 `X.Y.Z` 或 `X.Y.Z-(alpha|beta|rc).N`，`N ≥ 1`。阶段依次用于早期验证、功能测试、发布候选和正式交付；允许跳过阶段，禁止回退或重复。所有修改命令支持 `--dry-run`，不自动提交或创建标签。`start` 总会增加基础版本，同一目标应使用 `next / promote`。

`0.x` 的兼容修复升 patch，新功能或不兼容变化升 minor；`1.0.0` 后不兼容契约变化升 major。内部重构规模不决定版本号。构建元信息写入产物清单，应用版本不使用 `+build`。

升版前 `git fetch --tags`。候选版本必须高于本地同一 `MAJOR.MINOR` 版本线的已发布标签，其他维护线可独立推进。CI 比较基线时允许版本不变，变化必须向前；仅首次接入版本校验且没有阻挡标签时，允许把同一基础版本的占位号初始化为预发布。

升版与构建不要同时进行。脚本中断后，先确认没有更新进程，检查并恢复三个版本文件的一致状态、清理遗留临时文件和 `.version.lock`，再运行版本检查。

## 发布前检查

完成[实机验收](testing.md)，提交代码及版本，确认工作区干净。为该提交创建 `v` 加完整版本的标签，然后执行，例如：

```sh
pnpm version:check --release v0.1.0-rc.1
```

标签必须与应用版本一致并指向 HEAD；从标签触发 Windows 构建时自动校验。普通分支测试包允许沿用当前版本。已发布标签不移动或复用，仓库维护者需配置标签保护；历史标签可在原提交重新构建。

核对同次构建的 ZIP、NSIS、SHA-256 和验收记录，再手动发布。GitHub Release 中的 alpha／beta／rc 标为预发布，正式版附变更及兼容性说明。当前没有自动更新器，不能依赖 Windows 数字文件版本比较预发布顺序。
