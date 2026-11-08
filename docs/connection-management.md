# 连接管理

更新日期：2026-11-09。桌面和浏览器演示共享运行 Interface；Windows UAC、真实 TUN 和跨设备行为仍按[集中验收](windows-acceptance.md)验证。

## Module 与 Seam

| Module | Interface 与 Implementation |
| --- | --- |
| `features/networks/network-store.ts` | `initialize/reload/restore/create/save/connect/disconnect/reconnect/remove`；内部拥有持久化顺序、目标预留、草稿基线、快照归并及一次性启动队列 |
| `features/networks/runtime.ts` | 必需的 snapshot/start/stop/restart/confirmQuiescent；桌面与演示 Adapter 使用相同数据与完成语义 |
| `platform/configuration.ts` | Tauri 存储与运行 Adapter，不在原生失败后退回演示成功 |
| `features/networks/demo.ts` | 内存运行 Adapter、资源预留、演示会话与历史采样 |
| `features/networks/NetworkLifecycle.tsx` | 应用级前端缓存读取、焦点刷新及遥测过期检查，不属于布局或路由生命周期 |
| `cleartier-core::configuration` | 普通配置生成、TOML 投影／覆盖与运行前校验，隐藏固定上游版本的映射知识 |
| `cleartier-core::connections::NetworkManager` | 原生运行意图、逐网络调度、资源预留、就绪确认、恢复、取消及缓存发布 |
| `connections/operations.rs` | 任务准入、逐网络执行与迟到启动清理；耗时操作在状态锁外执行 |
| `process::CoreController` | 独立核心进程所有权、授权、本地通信及清理；独占并串行配对 worker 请求与响应 |

## 工作流顺序

同一网络的配置修改、删除、连接和重连在首次异步等待前取得预留，冲突请求返回 busy。不同网络独立推进，磁盘写入通过同一队列提交，选择、自动连接与设备图标按最新状态合并字段。重新加载和恢复备份不能穿插正在进行的任务。

编辑草稿携带 baseRevision，配置／本地名称／图标发生其他修改后拒绝旧草稿；遥测、选择及其他偏好不会使草稿失效。保存完成后才更新 savedConfig。立即应用捕获本次参数，持有预留直到重连完成；保存失败不启动核心。结果分别表达校验失败、目标忙、基线过期、磁盘冲突、保存失败、已保存和正在应用。应用完成结果区分成功和运行失败。

仅修改本地名称或图标直接生效，不应用待生效参数。普通连接使用已保存参数，主动重连使用本次捕获的已保存参数；显式重建失败后不重新启动旧配置。配置不合法或逻辑冲突在停止旧实例前拒绝。

删除仍要求用户先断开。前端预留目标后，Rust 的 release 操作检查没有实例、启动／停止任务、未释放资源或等待恢复，再取消残留恢复意图并返回确认，最后才提交磁盘删除。观察不可用时拒绝删除。写盘失败保留配置，之后可手动连接；删除不会隐式断开活动网络。

初始化只执行一次启动队列，冷缓存等待第一次可信运行观察。单项失败继续其他自动连接项，取消授权停止本次队列。reload/restore 合并磁盘与运行事实，不重跑启动队列。配置被外部移除但实例仍运行时保留断开入口，该临时记录不重新写入磁盘。

## 运行观察

Tauri 的 network_snapshot 只读取缓存，返回 `{epoch, health, error, networks}`。health 为 initializing、ready 或 stale；冷缓存不能推导全部停止。每个网络包含 revision、state、runningConfig、recoveryConfig、recovery、telemetry、实际网卡／地址及节点数量。未知测量显式为空；零节点的就绪实例仍是 running。

runningConfig 表达实际实例使用的参数；recoveryConfig 表达旧会话的恢复目标。待应用比较集中在配置 module，恢复使用旧目标而不读取已保存的新值。两者与磁盘参数分开，运行快照从不持久化。

前端按逐网络版本、操作代次和遥测会话归并结果；不通过一个全局版本丢弃其他网络的有效结果。命令完成时已经发布对应的运行观察。迟到读取既不能撤销新操作，也不能重新创建已删除的记录。采样期间发现的其他运行实例不会被随后完成的配置写入丢弃。

Rust 每秒查询核心和调度维护；前端每秒读取缓存，焦点恢复时额外读取，读请求不重叠。三秒没有新观察的原生缓存过期；重复返回同一遥测样本不会更新前端采样时间。查询失败保留最近设备、累计及参数，显示未知／过期。具体统计见[仪表盘真实数据](dashboard-telemetry.md)。

## 资源、恢复与退出

短时间锁内预留网络身份、TUN 名称和手动 IPv4，预留包含正在启动的配置。重建期间旧资源保留至停止确认，新资源保留至失败清理确认。实际 DHCP 地址冲突由原生维护调度停止较新实例，读取缓存没有停止副作用。尚不自动解决跨网络子网或路由重叠。

实例就绪要求真实 TUN-ready 事件与运行信息，最多等待 12 秒；等待在状态锁外，其他网络可继续读状态和操作。worker 帧仍由 CoreController 串行配对，不并行读写同一条通信流。

恢复使用断线前配置、2／5／15 秒退避及三次预算；连续稳定一分钟后重置。手动断开、禁用恢复或退出使旧任务失效。取消不放弃一半 IPC 响应：已经发出的启动结束通信后，迟到实例先被停止，才确认断开完成。后台恢复不触发 UAC；需要授权时等待手动重连。退出关闭新任务准入，等待目标任务及核心清理确认。详见[后台运行、恢复与诊断](desktop-lifecycle.md)。

## 验证

```bash
pnpm test
pnpm build
pnpm test:browser
cargo fmt --manifest-path src-tauri/Cargo.toml --all --check
cargo check --locked --manifest-path src-tauri/Cargo.toml --workspace
cargo test --locked --manifest-path src-tauri/Cargo.toml -p cleartier-config -p cleartier-core
```

工作流测试使用延迟存储及可控运行 Adapter，通过同一 Interface 覆盖并发、失败、重载和运行隔离。Rust 测试覆盖慢就绪、共享资源预留、恢复预算、在途恢复取消、迟到启动清理、冷缓存与过期；真实独立进程测试验证通信和多网络独立重连。`tests/fixtures/network-contract.json` 同时约束 TS 消费、Rust 存储与快照序列化。

浏览器回归使用独立会话、测试专用 Tauri fixture，不创建实际网卡。PR 自动检查完整工程；原生 Windows 构建仍运行核心库测试及打包后的 Direct／Process／Recovery／MissingResource 检查。它们不能替代 Windows 授权、真实网卡清理、后台运行及双机通信验收。
