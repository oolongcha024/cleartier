# 架构说明

界面通过 Tauri 调用普通权限的 Rust 应用，Rust 按需管理独立 EasyTier 核心进程。一个核心进程承载多个网络；浏览器使用同一运行 Interface 的内存 Adapter，原生失败不会伪装成演示成功。

## 模块职责

| 入口                                                            | 职责                                                           |
| --------------------------------------------------------------- | -------------------------------------------------------------- |
| [src/app](../src/app/)                                          | Provider、路由与外壳，常用页面静态导入                         |
| [features/networks](../src/features/networks/)                  | 编辑会话、工作流、持久化协调、运行观察及演示 Adapter           |
| [src/platform](../src/platform/)                                | Tauri 调用与浏览器能力隔离                                     |
| [features/dashboard](../src/features/dashboard/)                | 设备、流量及图表；共享控件、主题分别归 `components/`、`theme/` |
| [src-tauri/src](../src-tauri/src/)                              | Tauri 命令、应用路径和桌面生命周期组装                         |
| [cleartier-updates](../src-tauri/crates/cleartier-updates/src/) | 更新策略、持久检查间隔、渠道筛选及下载／安装状态               |
| [cleartier-config](../src-tauri/crates/cleartier-config/src/)   | 独立配置存储与后台偏好，不依赖 Tauri 或 EasyTier               |
| [cleartier-core](../src-tauri/crates/cleartier-core/src/)       | 配置转换、连接调度、遥测、核心进程与诊断                       |

核心依赖固定在 [Cargo.toml](../src-tauri/crates/cleartier-core/Cargo.toml) 的 EasyTier 提交；参数行为以该版本及仓库测试为准。升级时重新核对映射、兼容性和实机效果。

## 配置与操作顺序

`network-store.ts` 统一创建、保存、连接、断开、重连及删除。同一网络在首次异步等待前预留操作，不同网络独立推进；持久修改串行提交，并合并选择和偏好的最新值。

编辑草稿携带 `baseRevision`，拒绝覆盖被其他编辑修改的配置。保存成功后才更新 `savedConfig`；`runningConfig` 是实际实例参数，`recoveryConfig` 是异常恢复目标。仅修改展示信息不应用连接参数；保存失败不重连，显式应用失败不恢复旧参数。

删除须先断开，再经 `confirmQuiescent` 取得 Rust 对实例、任务和资源均已释放的确认，最后写盘。失败保留配置。重新加载合并磁盘与运行事实，不重复执行启动队列；磁盘记录消失但仍运行的实例保留断开入口，不重新写回文件。

## 原生调度与运行观察

[NetworkManager](../src-tauri/crates/cleartier-core/src/connections/mod.rs) 在短时间锁内检查意图并预留网络身份、TUN 和手动 IPv4，锁外完成核心通信及就绪等待。资源保留至停止或失败清理确认；实际 DHCP 地址冲突由维护任务处理，不由缓存读取触发。

`network_operation` 执行 start／stop／restart／release，完成时发布对应观察；`network_snapshot` 只读缓存，返回 epoch、health 和逐网络 revision。前端结合操作代次及会话归并，迟到结果不能撤销新操作或重建已删除记录。冷缓存为未同步，不代表全部停止；实例就绪及节点可达分别表达。

Rust 每秒采样，前端每秒读取缓存并在恢复焦点时刷新，读请求不重叠。三秒没有新观察即过期，重复样本不延长新鲜度。启动自动连接仅在首次可信观察后执行一次，取消授权停止本次队列。

## 核心进程、权限与退出

[CoreController](../src-tauri/crates/cleartier-core/src/process/controller.rs) 拥有核心子进程，串行配对请求与响应。工作进程入口先于 WebView 和 GUI 单实例检查分派。私有带长度帧协议限制为 1 MiB，控制端与核心随同一程序更新，不作为外部兼容接口。

Windows GUI 保持 `asInvoker`，需要 TUN 时仅核心请求 UAC。随机本地命名管道限制访问者并校验双方进程身份、协议与核心版本；提权前锁定程序和资源并校验 SHA-256。凭据通过 IPC 传递，不放入命令行；特权核心不读取用户指定的配置或日志路径。

Unix 使用私有目录和本地套接字，校验对端身份；非 Windows 自动 TUN 提权尚未实现。核心收到管道断开或检测到控制端退出后清理网络；明确退出先停止任务准入并取消恢复，再等待核心清理。托盘创建失败时保留可见窗口，避免隐藏后失去入口。

[恢复调度](../src-tauri/crates/cleartier-core/src/connections/recovery.rs) 在 Rust 后台执行：实例或核心意外退出后按 2／5／15 秒最多重试三次，连续稳定 60 秒才重置预算。查询失败不触发第二实例，节点暂不可达由 EasyTier 处理；配置、资源、身份错误或需要提权时停止自动重试。

主动断开、关闭恢复及退出使旧任务失效。已发出的启动仍需完成通信并清理迟到实例，再确认断开；不能靠丢弃请求留下运行资源。恢复意图仅在当前 GUI 会话内有效。

## 存储与 TOML

用户配置使用 Tauri `app_config_dir()`，运行目录和日志使用 `app_local_data_dir()`。网络文件由 [配置存储](../src-tauri/crates/cleartier-config/src/lib.rs)管理：

| 文件                                    | 内容                                         |
| --------------------------------------- | -------------------------------------------- |
| `networks.json`、`networks.backup.json` | 当前配置与上一次有效配置                     |
| `networks.lock`                         | 多进程写入锁                                 |
| `networks.damaged-<UUID>.json`          | 显式恢复前保留的异常原件                     |
| `desktop.json`                          | 独立的后台偏好                               |
| `updates.json`                          | 更新偏好、自动检查时间、服务端限流及候选版本 |

网络文档为 JSON v1，含 `revision / selectedId / networks`，记录分为 `client` 和 `config`。客户端信息与连接参数同次原子提交，保留未知字段；运行状态和流量不落盘。保存校验修订号，使用同目录临时文件替换，拒绝冲突、损坏、超限及不兼容版本；网络文档上限 4 MiB。

[configuration](../src-tauri/crates/cleartier-core/src/configuration/mod.rs) 拥有表单生成、TOML 投影、覆盖及连接前校验。`config.officialToml` 保留导入底稿，仅覆盖修改字段并使用本地实例 UUID；未知或暂不支持的字段允许存储导出，但阻止连接。文件、日志和外部配置来源字段不交给提权核心。字段映射与约束见该目录的 `editor.rs / projection.rs / validation.rs`，文件导入上限为 256 KiB。

## 遥测与设备身份

[核心遥测](../src-tauri/crates/cleartier-core/src/telemetry.rs) 按连接 UUID 累加字节增量，并补采连接移除事件的最终计数；重复、回退或移除不会扣减累计。重启实例生成新会话，统计可能因采样或事件丢失不完整，不承诺最后一字节精确落账。

字节以十进制字符串跨 IPC 传递，前端用 BigInt 求差。[遥测模块](../src/features/networks/telemetry.ts) 分别发布流量和设备读模型：流量逐秒更新，设备质量每三秒更新最新值，结构变化及测量失效立即生效；内容未变时复用对象。新鲜度按收到新样本的时间判断，与指标更新时钟独立。图表保留最近 60 秒，缺失样本分段。窗口隐藏或最小化时仅暂停向界面发布，流量速率、历史曲线和设备数据继续维护，运行状态同步与 Rust 采样、恢复继续；恢复显示后直接发布当前速率、连续历史和最新设备快照，并请求刷新。仅真实采样中断或会话变化时重建速率基线。指标含义见[使用指南](user-guide.md#设备与流量)。

设备图标只按明确的公共服务器角色及本机偏好选择。偏好键为远端配置实例 UUID，不是名称、IP 或临时 peer ID；缺失或重复 UUID 时不提供手动覆盖，不承诺识别物理设备。

## 邀请与诊断契约

邀请格式为 `cleartier:v1:<Base64url(UTF-8 JSON)>`，无填充；JSON 仅含 `name / secret / servers` 和可选 `displayName`，不包含本机参数。名称与密钥保留精确字符；拒绝未知版本、未知字段、多份邀请及非规范编码，解析不访问网络。长度、端点和字段限制集中在 [invitation.ts](../src/features/invitations/invitation.ts)，由[协议测试](../tests/invitations.test.mjs)约束。

[share-invitation.ts](../src/features/invitations/share-invitation.ts) 检查异步读取期间源参数未变；Rust 从实际生效的 TOML 提取最小加入信息，复杂凭据无法可靠表达时拒绝简化。桌面剪贴板只授予文本写入权限。

诊断通过 [support.rs](../src-tauri/crates/cleartier-core/src/support.rs) 的白名单导出状态、匿名实例、版本和错误码，排除密钥、网络／节点名称、地址、用户目录、原始 TOML、邀请及底层自由文本。日志有界轮换，原始日志不直接复制进诊断包。

## 软件更新

`cleartier-updates` 通过快照与操作 Interface 集中管理 24 小时自动检查、SemVer 渠道、持久化、取消与安装顺序。Tauri／静态更新源 Adapter 和测试 Adapter 共用该 Interface；React 只展示版本化快照并提交意图，浏览器预览不调用原生更新能力。计时位于 Rust，窗口隐藏不影响检查，失败尝试也计入间隔；手动检查绕过自动间隔，复用 60 秒内的成功结果，仍遵守服务端限流并展示重试时间。

客户端读取 GitHub Pages 的 `updates/updates.json`，不查询 Release API。索引 v1 包含 `schemaVersion / stable / preview`；稳定渠道可为空，预发布渠道包含正式版与预发布版中的最高 SemVer 版本。发布端只接纳已发布且附件完整的 Windows x64 版本，串行重建并部署整个索引。客户端拒绝不兼容或矛盾的索引，失败保留已知候选并明确提示错误；切换更新源时保留偏好，清除旧源的冷却与自动检查时间。

签名清单和安装包通过固定 HTTPS 仓库及版本的附件直链读取。传输故障和服务端错误最多重试三次，真实限流按响应时间退避；普通访问拒绝单独提示。官方 Tauri updater 验证 NSIS 签名及签名绑定的版本；未通过验证不能安装。ZIP 版仅打开下载地址，安装版由 NSIS 写入的当前用户安装路径识别。

下载期间保持连接；安装前在同一个核心状态锁内检查确认并关闭任务准入，等待进行中的请求及核心清理，再启动 NSIS。清理失败可重试；安装器启动失败后只恢复任务准入，不重新连接已停止的网络。升级保留配置，重启后沿用已有自动连接规则。
