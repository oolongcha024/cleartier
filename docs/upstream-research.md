# EasyTier 官方项目调查

调查日期：2026-11-07。

源码基准：官方 `main` 分支提交 [`6e87219`](https://github.com/EasyTier/EasyTier/commit/6e87219)。以下结论来自文档和源码阅读，未安装客户端进行实际运行验证。引用固定在该提交，后续版本行为可能变化。

## 1. 官方项目结构

官方仓库：[EasyTier/EasyTier](https://github.com/EasyTier/EasyTier)。

| 路径 | 作用 |
| --- | --- |
| `easytier-gui` | Tauri 2 客户端，前端使用 Vue 3、TypeScript、PrimeVue、Tailwind CSS |
| `easytier-web/frontend-lib` | GUI 与 Web 控制台共用的网络配置、状态及管理组件 |
| `easytier-web` | Web 控制台后端及相关设备、配置管理能力 |
| `easytier-core` 及相关模块 | 组网实例、管理接口和核心集成能力 |

主要参考：

- [GUI 依赖与构建脚本](https://github.com/EasyTier/EasyTier/blob/6e87219/easytier-gui/package.json)
- [共享前端库](https://github.com/EasyTier/EasyTier/tree/6e87219/easytier-web/frontend-lib)
- [GUI 主界面与运行模式](https://github.com/EasyTier/EasyTier/blob/6e87219/easytier-gui/src/pages/index.vue)
- [GUI 接口适配](https://github.com/EasyTier/EasyTier/blob/6e87219/easytier-gui/src/modules/api.ts)
- [前端调用 Tauri 后端](https://github.com/EasyTier/EasyTier/blob/6e87219/easytier-gui/src/composables/backend.ts)

可以保留官方组网核心并重做界面和交互，但需要实现适配层。普通浏览器页面本身不能替代本机核心／服务完成虚拟网卡、系统路由等操作。

## 2. 官方已有能力

源码中已有多网络管理、配置导入导出、文本编辑、服务模式、远程管理及配置服务器连接等能力。

共享组件中包含基础与高级网络配置、端口转发、ACL、WireGuard 接入，以及节点、协议、路由、延迟、丢包和流量等信息展示。

- [网络管理组件](https://github.com/EasyTier/EasyTier/blob/6e87219/easytier-web/frontend-lib/src/components/RemoteManagement.vue)
- [配置组件](https://github.com/EasyTier/EasyTier/blob/6e87219/easytier-web/frontend-lib/src/components/Config.vue)
- [状态组件](https://github.com/EasyTier/EasyTier/blob/6e87219/easytier-web/frontend-lib/src/components/Status.vue)

本项目的主要改善方向是用户任务组织、信息解释、操作反馈和分享体验，不是重新实现底层组网协议。

### 流量计数口径

官方状态组件对节点的连接列表汇总 `stats.rx_bytes`、`stats.tx_bytes`，再对当前网络的节点信息做汇总，并通过前后差值计算速率，见[流量汇总与速率计算](https://github.com/EasyTier/EasyTier/blob/6e87219/easytier-web/frontend-lib/src/components/Status.vue#L231)。这是当前网络的连接层计数，不能直接解释为系统所有网卡的互联网用量、目标应用的净荷流量或跨重启的历史累计。接入真实核心时还需处理连接消失、重建和计数回退，不能将连接快照求和当作永不减少的会话计数。

## 3. 运行状态的准确含义

核心内部实例状态包括 `Created / Starting / Running / Stopping / Stopped`，见[实例定义](https://github.com/EasyTier/EasyTier/blob/6e87219/easytier-core/src/instance/mod.rs#L128)。

但现有 GUI 使用的管理快照并未直接暴露完整内部状态枚举。`NetworkInstanceRunningInfo` 主要包含 `running`、`error_msg`、`events`，以及本机、路由和节点信息，见[管理协议](https://github.com/EasyTier/EasyTier/blob/6e87219/easytier-proto/proto/api_manage.proto#L169)。

快照中的 `running=true` 不等同于已成功连接其他节点：实现中除 `Created`、`Stopped` 外均算作 running，因此 Starting、Stopping 也可能被映射为 true。尚未 ready 时，其他信息还可能为空，见[快照构造](https://github.com/EasyTier/EasyTier/blob/6e87219/easytier-core/src/management/full/instance_info.rs#L19)。

核心事件包含节点添加／移除、连接添加／移除、手动连接尝试和错误、监听失败与重试等，见[事件定义](https://github.com/EasyTier/EasyTier/blob/6e87219/easytier-core/src/events.rs#L13)。

对界面的约束：

- 展示状态时应结合运行标记、节点数据、事件和错误。
- “正在寻找节点”等文案可能是前端推导，不能当作接口原生状态。
- 单条连接失败不一定意味着整个网络不可用。
- 取不到实例信息不等同于用户主动断开。
- 节点连接和指标不证明目标应用可访问，应用访问需要单独验证。

官方 GUI 根据路由 cost 展示 local、p2p、relay(n)；延迟和丢包展示有其连接选择逻辑。复用指标时应保留语义，见[状态组件](https://github.com/EasyTier/EasyTier/blob/6e87219/easytier-web/frontend-lib/src/components/Status.vue#L37)与[指标转换](https://github.com/EasyTier/EasyTier/blob/6e87219/easytier-web/frontend-lib/src/modules/statusDisplay.ts)。

## 4. 保存与应用配置

现有 GUI 的保存配置路径写入持久存储，但不直接修改或重启正在运行的实例。该路径还会设置存储中的 disabled 标记，集成时不能未经分析便将其等同于本项目的“保存草稿”。见[保存配置实现](https://github.com/EasyTier/EasyTier/blob/6e87219/easytier-core/src/management/full/remote_client.rs#L391)。

现有 GUI 的“保存并运行”根据网络是否禁用分别走保存后启用或 run_network，见[GUI 应用逻辑](https://github.com/EasyTier/EasyTier/blob/6e87219/easytier-web/frontend-lib/src/components/RemoteManagement.vue#L209)。

通用 run_network 路径使用 `overwrite: true`。覆盖现有实例时，会先删除目标实例，再以新配置运行，并有失败回滚逻辑。因此，该路径会重建目标网络连接，不能对用户承诺无中断应用所有字段。

- [运行请求](https://github.com/EasyTier/EasyTier/blob/6e87219/easytier-core/src/management/full/remote_client.rs#L157)
- [覆盖与重建实例](https://github.com/EasyTier/EasyTier/blob/6e87219/easytier-core/src/management/full/process_rpc.rs#L232)

以上结论仅针对已核查的通用 GUI 配置路径。EasyTier 存在其他专项配置接口，不能据此推断所有配置都不支持热更新。

本项目已确认的产品要求是允许先保存后应用，明确标记未生效修改并说明重连影响。具体存储和应用策略仍需设计，不能直接假设照搬官方保存接口即可满足要求。

## 5. 相关用户反馈

以下反馈用于识别需要关注的体验问题，不证明当前版本仍然存在同样缺陷：

- [#2357：Windows GUI 配置保存问题](https://github.com/EasyTier/EasyTier/issues/2357)：报告部分安全模式配置在保存后消失。调查时已关闭。
- [#2727：Android 启动与日志反馈](https://github.com/EasyTier/EasyTier/issues/2727)：涉及 TUN 启动及日志复制体验。调查时已关闭，Android 不在本项目第一版范围内。

这些反馈支持将配置完整保留和可导出诊断信息纳入需求，但不能直接转化为对当前官方版本的缺陷结论。

## 6. 调查限制与后续核查

- 尚未通过实际运行验证平台权限、后台服务、关闭／退出行为和安装体验。
- 尚未确定核心集成方式与桌面框架。
- 尚未逐项验证所有 TOML 配置往返保留能力。
- 邀请格式、配置字段边界和诊断探测方式尚未设计。
- 后续开发应固定并验证具体核心版本，不能仅凭主分支或搜索结果推定发布版行为。
