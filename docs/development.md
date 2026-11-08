# 开发指南

## 环境与启动

Node.js 与 pnpm 要求见 [package.json](../package.json)，Rust 与原生构建依赖以 [CI 工作流](../.github/workflows/check.yml)为准。桌面调试还需 [Tauri 系统依赖](https://v2.tauri.app/start/prerequisites/)、图形环境、protoc 和 libclang；浏览器预览无需桌面开发库。

```sh
pnpm install --frozen-lockfile
pnpm dev
```

开发服务及热更新使用 `http://10.126.179.2:5173`。独立浏览器入口不调用真实核心，原生能力通过适配层隔离。

| 命令                  | 用途                                                      |
| --------------------- | --------------------------------------------------------- |
| `pnpm tauri dev`      | 原生桌面调试；会启动前端服务，先停止独立运行的 `pnpm dev` |
| `pnpm build`          | 版本校验、类型检查及前端构建                              |
| `pnpm preview`        | 在 `http://10.126.179.2:4174` 预览已有前端产物            |
| `pnpm tauri build`    | 本机桌面构建                                              |
| `pnpm theme:generate` | 修改 `src/theme/palettes.ts` 后生成主题令牌               |
| `pnpm icons:generate` | 修改标志或品牌配色后生成网页、桌面图标                    |

主题与图标生成结果随代码提交，普通构建不需要重新生成。开发端口被占用时先检查已有服务，不修改远程访问地址。

## 自动化检查

使用 `pnpm format` 统一格式，`pnpm format:check` 只检查。Prettier 管理 TS／TSX、JS／MJS、CSS、JSON、YAML、Markdown 和 HTML，Rust 使用 rustfmt；TOML、PowerShell 和 NSIS 暂时保留原有格式。采用 LF 换行，前端缩进 2 空格、JS 单引号和分号、目标行宽 100；Markdown 保留段落换行。

VS Code 按仓库推荐安装 Prettier 和 rust-analyzer 后，按语言保存时格式化。生成的主题／图标、锁文件、第三方资源及签名测试材料不参与 Prettier 格式化；修改生成逻辑后重新生成，不手工整理输出。普通 CI 和 Windows 构建在测试、编译前检查格式。

在仓库根目录执行：

```sh
pnpm format:check
pnpm test
pnpm typecheck
pnpm build
cargo check --locked --manifest-path src-tauri/Cargo.toml --workspace
cargo test --locked --manifest-path src-tauri/Cargo.toml -p cleartier-config -p cleartier-core -p cleartier-updates
```

浏览器回归先安装 CI 对应的 runner，再执行：

```sh
npm install --global agent-browser@0.38.0
agent-browser install
pnpm test:browser
```

可追加场景名，例如 `pnpm test:browser network-editor-session desktop-lifecycle`。脚本自动启动或复用开发服务、隔离浏览器会话并清理；失败截图在 `.cache/browser/`。`BROWSER_WIDTH / BROWSER_HEIGHT / BROWSER_COLOR_SCHEME / BROWSER_REDUCED_MOTION` 用于最小窗口、深色及减少动态效果检查。测试覆盖边界和实机步骤见[测试与验收](testing.md)。

## Windows 构建

Windows x64 本机需要 MSVC、Windows SDK、Rust MSVC target、Git 和 protoc 等工具，具体版本及环境设置以 [Windows 工作流](../.github/workflows/windows-build.yml)为准。

直接执行 Windows 核心测试前，先运行 `node scripts/prepare-core-resources.mjs` 准备运行资源与链接库；下面的标准构建命令会自动准备：

```sh
pnpm build:windows all
```

参数可选 `exe`、`nsis`、`all`，其中 `exe` 导出完整免安装 ZIP。Linux 远程开发使用手动触发的 GitHub Actions，无需在宿主机安装 Windows 工具链：

```sh
gh workflow run windows-build.yml --ref main -f bundle=all
gh run list --workflow windows-build.yml
```

手动触发只生成 Actions Artifacts，支持选择产物类型。推送 `v*` 标签时固定构建 `all`，成功后自动上传至 Release 草稿，再发布。正常产物须通过测试、原生编译、图标／资源校验及打包程序检查；Artifacts 保留期限以工作流为准。

| 内容                         | 本机构建位置                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------- |
| 免安装目录／ZIP              | `artifacts/windows-x64/exe/`、`artifacts/windows-x64/cleartier-windows-x64.zip` |
| NSIS 安装包                  | `artifacts/windows-x64/nsis/`                                                   |
| 签名更新清单                 | `artifacts/windows-x64/latest.json`                                             |
| 版本、来源、工具链及 SHA-256 | `artifacts/windows-x64/build-info.json`                                         |
| 检查报告与失败诊断           | `artifacts/windows-x64/checks/`                                                 |

构建入口为 [scripts/windows/build.mjs](../scripts/windows/build.mjs)。ZIP 和安装包均携带项目许可文本。`build-info.json` 和检查报告仅保留在本机构建目录及 Actions Artifacts，Release 附件只有 ZIP、NSIS 和 `latest.json`；签名嵌入更新清单，`.sig` 不单独发布。先查看检查报告和工具链错误，交付时核对提交及校验值。

## 版本管理

应用版本以 `package.json.version` 为准，由 [版本脚本](../scripts/version.mjs)同步 Rust 应用包及其锁文件；内部 crate 和 EasyTier 核心版本独立。开发与构建只校验，不自动升版。

| 命令                                       | 作用                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------ |
| `pnpm version:start minor alpha --dry-run` | 预览下一基础版本的 `alpha.1`                                             |
| `pnpm version:start patch`                 | 基础补丁号加一，默认从 `alpha.1` 开始；也支持 `minor / major` 及指定阶段 |
| `pnpm version:next`                        | 当前预发布序号加一，如 `rc.1 → rc.2`                                     |
| `pnpm version:promote beta`                | 推进到更晚阶段，也可指定 `rc / stable`；新阶段从 `.1` 开始               |
| `pnpm version:set 0.2.0-beta.1`            | 显式设置严格更高的版本                                                   |
| `pnpm version:check`                       | 检查格式、Rust 同步及 Tauri 版本引用                                     |

版本格式为 `X.Y.Z` 或 `X.Y.Z-(alpha|beta|rc).N`，`N ≥ 1`。阶段依次用于早期验证、功能测试、发布候选和正式交付；允许跳过阶段，禁止回退或重复。所有修改命令支持 `--dry-run`，不自动提交或创建标签。`start` 总会增加基础版本，同一目标应使用 `next / promote`。

`0.x` 的兼容修复升 patch，新功能或不兼容变化升 minor；`1.0.0` 后不兼容契约变化升 major。内部重构规模不决定版本号。构建元信息写入产物清单，应用版本不使用 `+build`。

升版前 `git fetch --tags`。候选版本必须高于本地同一 `MAJOR.MINOR` 版本线的已发布标签，其他维护线可独立推进。CI 比较基线时允许版本不变，变化必须向前；仅首次接入版本校验且没有阻挡标签时，允许把同一基础版本的占位号初始化为预发布。

升版与构建不要同时进行。脚本中断后，先确认没有更新进程，检查并恢复三个版本文件的一致状态、清理遗留临时文件和 `.version.lock`，再运行版本检查。

## 发布

先手动构建并完成[实机验收](testing.md)，提交并推送包含工作流、实现及版本的代码，确认工作区干净。为该提交创建 `v` 加完整版本的标签，例如：

```sh
git tag -a v0.1.0-rc.1 -m "ClearTier 0.1.0-rc.1"
pnpm version:check --release v0.1.0-rc.1
git push origin v0.1.0-rc.1
```

标签必须与应用版本一致并指向 HEAD。推送后按顺序执行：Windows 构建及检查 → 创建或复用草稿 → 上传 ZIP／NSIS／latest.json 并核对远端 SHA-256 → 发布。此顺序兼容 [GitHub 不可变发布](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases)，无需预先在网页点击发布。

alpha／beta／rc 自动标为预发布；正式版按 GitHub 的版本规则决定 Latest。新草稿自动生成发布说明，已有草稿保留标题与正文，可提前编辑说明再推送标签。编译任务只读仓库，独立发布任务才持有写权限，使用内置 `GITHUB_TOKEN`，无需另配 PAT。

构建失败不创建 Release，上传或校验失败保留草稿；在 Actions 重跑失败任务可继续上传。已发布的相同附件可安全重跑，不会覆盖不同内容；重新构建产生不同文件时应推进新版本。标签被移动或附件不匹配会中止发布。

普通分支测试包允许沿用当前版本，手动构建标签也不会发布。已发布标签不移动或复用，仓库维护者需配置标签保护。更新器按 SemVer 比较完整版本，不依赖 Windows 数字文件版本比较预发布顺序。

## 更新签名

NSIS 构建必须设置 `TAURI_SIGNING_PRIVATE_KEY`，加密密钥另需 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`；GitHub Actions 从同名仓库 Secrets 读取。仅构建免安装 ZIP（`exe`）不需要签名密钥。客户端公钥唯一来源为 `src-tauri/tauri.conf.json`，启用版本绑定签名；构建时验证安装包、签名版本和公钥匹配后才生成 `latest.json`。这不替代 Windows Authenticode 代码签名。

当前签名私钥在开发机 `~/.config/cleartier/signing/updater.key`，应另行离线备份，禁止提交或随包交付。后续发布复用同一密钥；丢失密钥无法向现有客户端推送可信更新。轮换前先用旧密钥发布包含新公钥的过渡版本。

更新地址固定使用公开仓库的 HTTPS 地址，不携带访问令牌；仓库公开且 Release 包含完整三个附件后才可正常检查。首个包含更新器的版本须手动安装一次，后续安装版可从关于页升级。
