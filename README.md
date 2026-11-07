# ClearTier（暂定名）

基于 EasyTier 核心的跨平台本地桌面客户端，面向异地组网、远程办公和游戏联机，重点改善界面、操作流程以及网络邀请分享体验。

当前处于需求与原型阶段，尚未实现客户端，也未接入真实组网核心。项目名称暂沿用仓库目录名，尚未正式确定。

## 项目文档

- [第一版需求基线](docs/requirements.md)：已确认的功能范围、行为约定、验收场景及待定事项。
- [官方项目调查](docs/upstream-research.md)：官方项目结构、接口行为及设计约束。
- [原型方向记录](docs/prototype-design.md)：A 方案选择，以及仪表盘与网络下拉框的迭代方向。

## 开发准备

使用 Node.js 24+、pnpm 11.26.0。依赖均固定版本，首次安装运行：

```bash
pnpm install --frozen-lockfile
```

当前依赖方案：

| 用途 | 依赖 |
| --- | --- |
| 桌面集成 | Tauri 2 API、CLI |
| 前端与构建 | React 19、TypeScript 6、Vite 8 |
| 交互与 MD3 主题 | Base UI、Material Color Utilities、Material Symbols |
| 路由与状态 | React Router、Zustand |
| 国际化 | i18next、react-i18next |

[Base UI](https://base-ui.com/react/overview/quick-start) 提供无样式交互组件；后续按 Material Design 3 实现组件视觉和状态表现，[Material Color Utilities](https://github.com/material-foundation/material-color-utilities) 用于色彩方案。依赖安装不代表已完成 MD3 组件实现。

当前只完成依赖准备，尚未创建前端入口、构建配置或 Tauri Rust 工程，因此暂不提供应用开发／打包命令。

## 下一步

可交互原型已创建于 `/tmp/cleartier/prototype`，当前基于 A 方向迭代为仪表盘首页，使用下拉框选择网络，详细配置独立分页面。原型使用模拟数据，暂不接入真实 EasyTier 核心。

访问 <http://10.126.179.2:4173/>；启动命令为 `python /tmp/cleartier/prototype/serve.py`。

后续展示 Web 原型时，服务统一监听 `10.126.179.2`，访问地址和启动命令同样使用该 IP。
