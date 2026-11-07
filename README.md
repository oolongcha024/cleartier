# ClearTier（暂定名）

基于 EasyTier 核心的跨平台本地桌面客户端，面向异地组网、远程办公和游戏联机，重点改善界面、操作流程以及网络邀请分享体验。

当前已实现 MD3 基础组件、侧边导航和使用模拟数据的仪表盘，尚未接入真实组网核心。项目名称暂沿用仓库目录名，尚未正式确定。

## 项目文档

- [第一版需求基线](docs/requirements.md)：已确认的功能范围、行为约定、验收场景及待定事项。
- [官方项目调查](docs/upstream-research.md)：官方项目结构、接口行为及设计约束。
- [Podman Windows 构建](docs/windows-build.md)：生成直接运行的 Windows x64 程序、NSIS 安装包或两者。

## 开发准备

Node.js 和 pnpm 的版本要求见 [package.json](package.json) 中的 `engines` 和 `packageManager`。首次安装运行：

```bash
pnpm install --frozen-lockfile
```

当前依赖方案：

| 用途 | 依赖 |
| --- | --- |
| 桌面集成 | Tauri API、CLI |
| 前端与构建 | React、TypeScript、Vite |
| 交互与 MD3 主题 | Base UI、Material Color Utilities、Material Symbols |
| 路由与状态 | React Router、Zustand |
| 国际化 | i18next、react-i18next |

[Base UI](https://base-ui.com/react/overview/quick-start) 提供选择器、开关、弹窗和提示的交互底座，组件视觉使用 MD3 色彩角色、色调容器和状态样式。[Material Color Utilities](https://github.com/material-foundation/material-color-utilities) 用于生成浅色与深色主题，色彩结果保存在 CSS 中，不在客户端加载色彩引擎。

## 当前界面

仪表盘支持切换查看网络、模拟连接与断开、修改自动连接开关、复制 IP、查看设备和流量。各网络独立操作，切换查看对象不会改变其他网络的连接。

首页以当前网络为中心，通过顶部下拉框切换查看对象，选项标明各网络连接状态；在线网络数量单独显示。连接状态与快捷操作之后依次为整行流量卡片、设备列表。宽布局下流量统计在左、趋势图在右，窄布局下上下排列，沿用主内容宽度的同一分界。

流量卡片同时展示实时速率和当前网络的本机累计下载、上传量；累计量按字节保存，以 KiB、MiB、GiB 等单位显示。演示数据在断开后保留上一次连接的累计量，重新连接时只重置目标网络。当前累计数值为演示快照，尚未接入核心实时计数，也不代表整台机器的互联网流量或跨连接的历史用量。

网络状态与自动连接选项仅保存在内存中，刷新后恢复演示数据；外观偏好保存在本机浏览器存储中。连接不代表已验证目标服务可访问。网络配置页集中展示已保存网络，支持分别模拟连接和断开；连接参数编辑、设备详情、连接详情和诊断页面仍待实现。邀请和加入按钮暂不可用；设置页提供外观选择。

前端代码按职责组织：`src/components/` 为基础组件，`src/theme/` 为主题，`src/features/` 为业务视图与模拟状态，`src/lib/i18n.ts` 集中维护中文文案。页面不调用 Tauri 原生 API，可以独立在浏览器中运行。

界面按桌面客户端设计，最小窗口为 900×600，默认 1200×800。侧栏展开宽度为 200px，手动收起后为 88px，不随窗口宽度自动切换。仪表盘只按主内容可用宽度的 800px 分界切换单双列，快捷操作始终为两列。主内容纵向滚动，侧栏导航在空间不足时独立滚动；浏览器窗口小于支持尺寸时允许整页滚动，不另设手机布局。

动效使用 MD3 标准曲线，统一定义在 `src/theme/motion.css`，参考 [Material 动效令牌](https://github.com/material-components/material-components-android/blob/master/docs/theming/Motion.md)。侧栏平滑收展时图标列保持固定，文字独立淡入淡出；页面、选择器、弹窗和提示消息提供轻量进出过渡。系统启用“减少动态效果”时跳过位移和延时。

调整主题种子色后，运行以下命令重新生成并提交色彩令牌；普通开发和构建不需要执行：

```bash
pnpm theme:generate
```

主题种子和生成逻辑位于 `scripts/generate-theme.mjs`。

品牌标志采用 CT 字母方案，矢量源文件位于 `src/assets/logo-mark.svg`。侧栏使用该矢量作为遮罩，以适配浅色和深色主题。修改标志后运行 `pnpm icons:generate`，同步生成网页图标及桌面打包所用的 PNG、ICO、ICNS；生成结果随代码提交，普通构建无需重新生成。

## 运行工程

远程开发时，先启动独立前端服务：

```bash
pnpm dev
```

在浏览器中访问终端输出的服务地址，支持热更新。

单元测试、前端类型检查、构建和构建产物预览：

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm preview
```

运行 `pnpm preview` 后，访问终端输出的预览地址。

具备桌面系统依赖和图形环境时，可以运行原生窗口或打包：

```bash
pnpm tauri dev
pnpm tauri build
```

Tauri 与浏览器预览共用前端入口。`tauri dev` 会自行启动开发服务，使用前先停止独立运行的 `pnpm dev`。

原生桌面构建需要满足 [Tauri 系统依赖要求](https://v2.tauri.app/start/prerequisites/)。仅使用浏览器预览时，无需桌面系统开发库。

## 下一步

实现独立的网络配置页面和邀请流程，再通过适配层接入 EasyTier 核心，替换模拟状态。
