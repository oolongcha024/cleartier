# 核心运行基础

本文描述阶段 1 的进程管理与控制接口。阶段 2 已实现桌面配置持久化，浏览器继续使用演示数据；真实连接交互留到阶段 3。存储约定见[网络配置存储](network-configuration.md)。

## 代码入口

| 位置 | 职责 |
| --- | --- |
| `src-tauri/src/lib.rs` | 在创建 WebView 前分派核心入口，界面退出时关闭所拥有的核心 |
| `src-tauri/src/core_commands.rs` | Tauri 命令与应用路径、状态组装 |
| `src-tauri/crates/cleartier-core/src/entry.rs` | 无界面工作进程和检查入口 |
| `…/src/process/controller.rs` | 按需启动、权限升级、请求串行化、状态、超时与退出管理 |
| `…/src/process/worker.rs` | 验证控制端身份，执行请求，断开后清理网络 |
| `…/src/process/platform/` | Windows 命名管道、UAC、资源锁定，以及 Unix 本地套接字 |
| `…/src/process/wire.rs` | 私有的带长度帧协议，不作为外部兼容接口 |
| `…/src/lib.rs` | 真实 EasyTier 多实例及类型化 TUN 错误事件 |

核心模块独立于 Tauri。测试使用独立的 `core-test-host` 可执行文件调用同一个入口，不需要 WebKitGTK；它不进入发布包。

## 对界面的接口

| Tauri 命令 | 行为 |
| --- | --- |
| `core_version` | 返回链接的核心版本，不启动进程 |
| `core_status` | 返回控制进程状态、PID、权限、版本、最近的进程错误及目录 |
| `core_start(toml)` | 验证配置并按需启动核心，返回实例 ID；接受请求不代表连接就绪 |
| `core_stop(instanceId)` | 停止指定实例，保持其他实例运行 |
| `core_snapshot` | 查询实例实际状态；尚未取得状态时 `running` 为 `null` |
| `core_shutdown` | 清理所有实例并确认核心退出 |

控制端状态为 `stopped`、`starting`、`ready`、`failed`。丢失核心后的查询返回错误，避免将其显示为健康的空列表。错误返回 `{ code, message }`，包括 `elevation_cancelled`、`missing_resource`、`resource_mismatch`、`core_exited`、超时及配置错误。网络侧的 TUN 错误来自 `GlobalCtxEvent::TunDeviceError`，恢复事件清除该错误。

一个控制端拥有一个核心进程，该进程管理多个网络。非 TUN 配置可以普通权限运行；TUN 配置在 Windows 上按需提权。已有普通权限核心正在运行网络时，升级权限会明确报错，要求先停止这些实例，避免升级过程静默断开连接。已经提权的核心可继续承载其他网络。

## Windows 本地通信与权限

- 界面清单保持 `asInvoker`。只有启动需要 TUN 的核心时使用 `ShellExecuteExW` 的 `runas`。UAC 取消返回独立错误，并恢复到停止状态。
- 控制端创建随机命名管道，使用受保护 DACL，仅允许当前用户、管理员和 SYSTEM，拒绝远程客户端，并限制为第一个管道实例。
- 控制端通过 Windows 管道客户端 PID 与所持有的子进程句柄校验核心身份。核心检查服务器 PID、控制端进程映像，并持有控制端句柄以防 PID 重用。握手还检查协议及核心版本。
- 提权客户端明确使用 `SECURITY_IDENTIFICATION`，防止普通权限管道服务器模拟其管理员令牌。
- 可执行文件和运行资源在提权前锁定，资源 SHA-256 对照编译时嵌入的清单验证；文件锁随核心生命周期保留。核心启动后再次校验资源。进程间的配置和密钥通过管道传递，不进入命令行；核心启动不产生临时凭据文件。用户主动保存的配置由普通权限存储 Module 按阶段 2 的明文方案落盘。
- 特权核心不接受文件凭据、配置来源及文件日志字段；配置文件和日志由普通权限界面管理。
- 请求按顺序执行，消息最多 1 MiB。核心就绪等待为 15 秒，请求等待为 10 秒。断开后清理实例；独立读取任务和控制端存活监控提供 5 秒的退出兜底。

实现依据：[命名管道安全](https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-security-and-access-rights)、[管道客户端 PID](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getnamedpipeclientprocessid)、[ShellExecute 启动与提权](https://learn.microsoft.com/en-us/windows/win32/shell/launch)。Windows 行为以实际测试结果为准。

## 目录与退出

界面通过 Tauri 获取 `app_config_dir` 和 `app_local_data_dir`，不在核心中硬编码用户目录。配置目录由阶段 2 的存储 Module 管理；运行目录和日志位于应用数据目录的 `runtime/`、`logs/`，按需启动核心时才创建。目录不可写不阻止打开界面，相关操作返回实际错误。进程日志只记录操作、PID、时间及错误码，单文件约 512 KiB 后轮换，保留一份旧日志。

当前退出界面会关闭其核心进程。管道断开或控制端异常退出时，核心自行结束网络；普通关闭优先等待清理完成。托盘和关闭窗口后继续运行留到阶段 7。

Unix 使用私有目录中的本地套接字，目录权限为 `0700`、套接字为 `0600`，并校验对端 PID/UID。Linux 上已运行真实进程测试。macOS 的进程身份和实际运行仍待单独适配验收；非 Windows 的自动提权尚未实现，TUN 请求明确报不支持。

## 验证

Rust 核心测试命令为 `cargo test --locked -p cleartier-core`，覆盖实际进程的多网络控制、异常退出与重启、错误配置、IPC 帧限制及对端身份拒绝。Linux 断网容器中已有通过记录。当前 Windows CI 使用打包程序运行 Direct／Process／Recovery／MissingResource 检查，四项已在首轮原生构建中通过。

Windows 分项实机步骤见 [Windows 构建与测试](windows-build.md)。编译及 Linux 测试成功不能替代 UAC、真实驱动和网卡清理的 Windows 验收。

2026-11-08 用户回传的 Windows `Process`、`Cancel`、`Tun`、`Recovery`、`MissingResource` 五项报告全部通过，且错误与清理错误均为空。它们确认了正常命名管道通信、仅核心提权、UAC 取消、双 TUN 的创建与正常清理、普通权限无 TUN 核心的异常恢复，以及缺少 Wintun 时的启动前拒绝。详细结果与尚未覆盖的范围见 [PLAN.md](../PLAN.md)。
