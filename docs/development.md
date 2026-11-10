# 开发指南

## 环境与启动

Node.js 与 pnpm 要求见 [package.json](../package.json)，Rust 与原生构建依赖以 [CI 工作流](../.github/workflows/check.yml)为准。桌面调试还需 [Tauri 系统依赖](https://v2.tauri.app/start/prerequisites/)、图形环境、protoc 和 libclang；浏览器预览无需桌面开发库。

```sh
pnpm install --frozen-lockfile
pnpm dev --host 10.126.179.2 --port 5173
```

上述命令监听 `10.126.179.2`，访问 `http://10.126.179.2:5173`。`--host` 与 `--port` 支持空格或等号写法，例如 `--host=10.126.179.2 --port=5188`，热更新使用同一地址。地址优先级为命令行 `--host` → 旧环境变量 `CLEARTIER_DEV_HOST` → `.env.local` → `localhost`；后两种旧配置仍兼容，但不再需要设置。端口未指定时，开发服务为 `5173`、产物资源预览为 `4174`。

前端监听、热更新、`pnpm tauri dev` 和浏览器测试共用此地址，开发端口可用 `--port` 调整。Tauri 调试通过临时配置同步覆盖 `devUrl` 和前端启动命令，自动向前端传递相同的 `--host / --port`，不修改仓库配置；正式构建不读取这项本机设置。前端只有一套页面与 Store，数据来源在创建 Store 前统一选择；浏览器用于开发调试，正式产品依赖 Tauri。

| 命令                                             | 用途                                                      |
| ------------------------------------------------ | --------------------------------------------------------- |
| `pnpm tauri dev --host 10.126.179.2 --port 5173` | 原生桌面调试；会启动前端服务，先停止独立运行的 `pnpm dev` |
| `pnpm build`                                     | 版本校验、类型检查及前端构建                              |
| `pnpm preview --host 10.126.179.2 --port 4174`   | 在 `4174` 端口检查构建资源；正式产物的原生功能需要 Tauri  |
| `pnpm tauri build`                               | 本机桌面构建                                              |
| `pnpm theme:generate`                            | 修改 `src/theme/palettes.ts` 后生成主题令牌               |
| `pnpm icons:generate`                            | 修改标志或品牌配色后生成网页、桌面图标                    |

主题与图标生成结果随代码提交，普通构建不需要重新生成。开发端口被占用时明确报错，不会自动切换端口；可停止已有服务或用 `--port` 指定其他端口。Tauri 的地址参数放在第一个 `--` 之前，其后的 runner／应用参数保持原样。

## 开发场景与模拟数据

打开 `http://10.126.179.2:5173`，点击右下角“开发 · 模拟数据”面板，选择网络、软件更新、诊断或桌面场景。下载场景支持进度滑块；外观可选择浅色、深色或跟随系统，窗口尺寸通过浏览器或 Tauri 窗口调整。

浏览器开发默认使用模拟数据；Tauri 开发默认使用真实数据，可在同一面板中切换到模拟数据。URL 的 `dataSource=mock` 与 `scene` 保存当前选择，便于复制和刷新复现。例如：

- [更新下载中](http://10.126.179.2:5173/?dataSource=mock&scene=updates.downloading#/settings/about)
- [网络连接失败](http://10.126.179.2:5173/?dataSource=mock&scene=networks.failed#/)
- [诊断异常](http://10.126.179.2:5173/?dataSource=mock&scene=diagnostics.issues#/settings)

切换数据来源、场景或调试外观会重新加载页面，丢弃当前草稿、重建 Store 并重置模拟配置和异步任务。模拟数据全部保存在内存；系统启动项、剪贴板、文件、网络及安装操作均由模拟实现接管。主题偏好仍使用前端自己的本地存储。

平台合同位于 [contracts.ts](../src/platform/contracts.ts)，真实实现位于 [native.ts](../src/platform/native.ts)。开发实现集中在 [dev/](../dev/)：场景目录为 [scenarios/index.ts](../dev/scenarios/index.ts)，网络种子数据为 [scenarios/networks.ts](../dev/scenarios/networks.ts)，网络、更新和其余平台行为分别由 `mock-networks.ts`、`mock-updates.ts`、`mock-platform.ts` 提供。新增场景时同时注册目录并设置对应模拟状态。浏览器测试直接复用这些实现，`scene=testing` 提供稳定的测试初始数据。

`src/main.tsx` 仅在 `import.meta.env.DEV` 下加载开发入口；正式构建固定使用真实 Tauri 实现，忽略场景 URL。构建插件会拒绝包含 `dev/` 或 `tests/` 模块的产物。`pnpm test` 同时验证构建隔离和模拟实例间的状态隔离。原来的 `/dev/updates.html` 独立入口已移除，统一从应用入口调试。

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
pnpm test:browser --host 10.126.179.2 --port 5173
```

可追加场景名，例如 `pnpm test:browser --host 10.126.179.2 --port 5173 network-editor-session desktop-lifecycle`。脚本使用共享模拟数据来源，自动启动或复用开发服务、隔离浏览器会话并清理；失败截图在 `.cache/browser/`。`BROWSER_WIDTH / BROWSER_HEIGHT / BROWSER_COLOR_SCHEME / BROWSER_REDUCED_MOTION` 用于最小窗口、深色及减少动态效果检查。测试覆盖边界和实机步骤见[测试与验收](testing.md)。

## Windows 构建

Windows x64 本机需要 MSVC、Windows SDK、Rust MSVC target、Git 和 protoc 等工具，具体版本及环境设置以 [Windows 工作流](../.github/workflows/windows-build.yml)为准。

CI 使用 PowerShell 7 运行 [setup-build-tools.ps1](../scripts/windows/setup-build-tools.ps1)：调用 Visual Studio 官方开发环境入口启用 x64 工具链，校验固定 SHA-256 后解压 protoc 21.12，并验证编译、链接与标准 protobuf 导入。环境增量传递给后续步骤；签名凭据不写入日志。Action 使用原生 Node 24 版本并固定完整提交 SHA，项目 Node.js 版本单独固定。

直接执行 Windows 核心测试前，先运行 `node scripts/prepare-core-resources.mjs` 准备运行资源与链接库；下面的标准构建命令会自动准备：

```sh
pnpm build:windows all
```

参数可选 `exe`、`nsis`、`all`，其中 `exe` 导出完整免安装 ZIP。Linux 远程开发使用手动触发的 GitHub Actions，无需在宿主机安装 Windows 工具链：

```sh
gh workflow run windows-build.yml --ref main -f bundle=all
gh run list --workflow windows-build.yml
```

手动触发只生成 Actions Artifacts，支持选择产物类型。`cleartier-windows-x64-*` 包含用户测试包和更新清单；`windows-diagnostics-*` 单独保存构建清单、检查报告与日志。构建后独立下载两个 Artifact，核对合并目录、来源提交、文件大小与 SHA-256；手动构建也执行此检查。推送 `v*` 标签时固定构建 `all`，检查通过后自动上传至 Release 草稿，再发布。正常产物须通过测试、原生编译、图标／资源校验及打包程序检查；Artifacts 保留期限以工作流为准。

| 内容                         | 本机构建位置                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------- |
| 免安装目录／ZIP              | `artifacts/windows-x64/exe/`、`artifacts/windows-x64/cleartier-windows-x64.zip` |
| NSIS 安装包                  | `artifacts/windows-x64/nsis/`                                                   |
| 签名更新清单                 | `artifacts/windows-x64/latest.json`                                             |
| 版本、来源、工具链及 SHA-256 | `artifacts/windows-x64/build-info.json`                                         |
| 检查报告与失败诊断           | `artifacts/windows-x64/checks/`                                                 |

构建入口为 [scripts/windows/build.mjs](../scripts/windows/build.mjs)。ZIP 与 NSIS 共用运行资源白名单，携带程序、DLL／驱动和许可文本；检查脚本及已嵌入程序的资源清单不随包交付。`build-info.json` 和检查报告保留在本机构建目录及独立诊断 Artifact，发布任务从中读取内部证据进行校验。Release 附件只有 ZIP、NSIS 和 `latest.json`；签名嵌入更新清单，`.sig` 不单独发布。先查看检查报告和工具链错误，交付时核对提交及校验值。

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

标签必须与应用版本一致并指向 HEAD。推送后按顺序执行：Windows 构建及检查 → 创建或复用草稿 → 上传 ZIP／NSIS／latest.json 并核对远端 SHA-256 → 发布 → 部署静态更新索引。此顺序兼容 [GitHub 不可变发布](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases)，无需预先在网页点击发布。

alpha／beta／rc 自动标为预发布；正式版按 GitHub 的版本规则决定 Latest。新草稿自动生成发布说明，已有草稿保留标题与正文，可提前编辑说明再推送标签。编译任务只读仓库，独立发布任务才持有写权限，使用内置 `GITHUB_TOKEN`，无需另配 PAT。

构建失败不创建 Release，上传或校验失败保留草稿；在 Actions 重跑失败任务可继续上传。已发布的相同附件可安全重跑，不会覆盖不同内容；重新构建产生不同文件时应推进新版本。标签被移动或附件不匹配会中止发布。

普通分支测试包允许沿用当前版本，手动构建标签也不会发布。已发布标签不移动或复用，仓库维护者需配置标签保护。更新器按 SemVer 比较完整版本，不依赖 Windows 数字文件版本比较预发布顺序。

## 更新签名

NSIS 构建必须设置 `TAURI_SIGNING_PRIVATE_KEY`，加密密钥另需 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`；GitHub Actions 从同名仓库 Secrets 读取。仅构建免安装 ZIP（`exe`）不需要签名密钥。客户端公钥唯一来源为 `src-tauri/tauri.conf.json`，启用版本绑定签名；构建时验证安装包、签名版本和公钥匹配后才生成 `latest.json`。这不替代 Windows Authenticode 代码签名。

当前签名私钥在开发机 `~/.config/cleartier/signing/updater.key`，应另行离线备份，禁止提交或随包交付。后续发布复用同一密钥；丢失密钥无法向现有客户端推送可信更新。轮换前先用旧密钥发布包含新公钥的过渡版本。

客户端从 `https://oolongcha024.github.io/cleartier/updates/updates.json` 检查版本，再通过公开 Release 附件直链读取签名清单和安装包，全程不携带访问令牌、不查询 GitHub REST API。索引由 [Publish update index](../.github/workflows/update-index.yml) 使用内置 `GITHUB_TOKEN` 从已发布且附件完整的版本重建：`stable` 为最高正式版，`preview` 为包含正式版的最高版本；暂无候选时为 `null`。

Pages 发布源设为 GitHub Actions，`github-pages` 环境允许 `main` 分支和 `v*` 标签部署。版本发布后调用索引工作流；手动编辑、撤回或删除 Release 也会重建。并发部署串行执行。索引失败不会回滚已发布 Release，可单独运行 `gh workflow run update-index.yml --ref main` 重试，无需重新编译安装包。`pnpm updates:generate` 可在 `.cache/update-site` 本地生成索引，输出目录也可作为参数指定。

索引是 Pages 产物，Release 附件仍只有 ZIP、NSIS 和 `latest.json`。已发布的 rc1 使用旧版 API 检查入口，需通过原有更新路径或手动安装升级到包含静态更新源的新版本；后续版本继续使用同一签名公钥。
