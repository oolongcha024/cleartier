# ClearTier（暂定名）

基于 EasyTier 核心的跨平台本地桌面客户端，面向异地组网、远程办公和游戏联机，重点改善界面、操作流程以及网络邀请分享体验。

当前已建立 React/Vite/Tauri 最小工程骨架，尚未实现业务页面或接入真实组网核心。项目名称暂沿用仓库目录名，尚未正式确定。

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

[Base UI](https://base-ui.com/react/overview/quick-start) 提供无样式交互组件；后续按 Material Design 3 实现组件视觉和状态表现，[Material Color Utilities](https://github.com/material-foundation/material-color-utilities) 用于色彩方案。依赖安装不代表已完成 MD3 组件实现。

## 运行工程

远程开发时，先启动独立前端服务：

```bash
pnpm dev
```

在浏览器中访问终端输出的服务地址，支持热更新。

前端类型检查、构建和构建产物预览：

```bash
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

按已确认的原型方向实现仪表盘首页，通过下拉框选择当前查看的网络，详细配置独立分页面。交互先使用模拟数据验证，再接入 EasyTier 核心。
