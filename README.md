<p align="center">
  <img src="public/app-icon.svg" alt="ClearTier logo" width="96" height="96" />
</p>

<h1 align="center">ClearTier</h1>

<p align="center">基于 EasyTier 的桌面组网客户端</p>

<p align="center">
  <a href="docs/user-guide.md">使用指南</a> ·
  <a href="docs/development.md">开发文档</a> ·
  <a href="https://github.com/oolongcha024/cleartier/issues">问题反馈</a>
</p>

ClearTier 面向异地组网、远程办公和游戏联机，将多网络连接、配置迁移与邀请分享整合到 Material Design 3 界面中。客户端内置 [EasyTier](https://github.com/EasyTier/EasyTier) 核心，无需另装官方客户端。

## 功能

- **多网络管理**：同时运行多个网络，独立连接、断开和重连；配置可先保存，再选择何时应用。
- **邀请分享**：复制邀请、粘贴填入，确认后手动加入，保留接收方的本机设置。
- **配置迁移**：导入、导出官方 TOML，保留界面未展示的字段，并提示兼容性问题。
- **设备与流量**：查看虚拟 IP、直连／中转、延迟、丢包及当前会话流量，未知指标明确标记。
- **后台与诊断**：支持托盘、登录启动、逐网络自动连接、有限异常恢复和脱敏诊断导出。

## 使用与平台状态

项目处于预发布测试阶段，当前优先验证 Windows，完整实机验收仍在进行。macOS、Linux 的安装、权限和后台行为待分别验证，非 Windows 自动 TUN 提权尚未实现。

推送版本标签后，[Build Windows 工作流](https://github.com/oolongcha024/cleartier/actions/workflows/windows-build.yml)自动构建完整免安装 ZIP 和 NSIS 安装包，上传到草稿后发布至 [Releases](https://github.com/oolongcha024/cleartier/releases)。手动测试构建仍通过 Actions Artifacts 获取；操作见[开发指南](docs/development.md#windows-构建)。免安装包需完整解压，保留随包运行资源。

连接已有网络、邀请加入与配置迁移的操作见[使用指南](docs/user-guide.md)。

## 本地开发

按 [package.json](package.json) 的要求准备 Node.js 和 pnpm，在仓库目录运行：

```sh
pnpm install --frozen-lockfile
pnpm dev
```

访问 `http://10.126.179.2:5173`，支持热更新。浏览器预览使用演示数据，真实组网需运行桌面客户端。Tauri 调试、系统依赖和检查命令见[开发指南](docs/development.md)。

## 文档

| 文档 | 内容 |
| --- | --- |
| [使用指南](docs/user-guide.md) | 网络管理、邀请、配置迁移、后台与问题排查 |
| [开发指南](docs/development.md) | 环境、调试、测试命令、构建与版本管理 |
| [架构说明](docs/architecture.md) | 模块职责、运行调度、存储与协议约定 |
| [测试与验收](docs/testing.md) | 自动化覆盖边界、实机清单与结果记录 |

## 参与贡献

欢迎通过 [Issues](https://github.com/oolongcha024/cleartier/issues)反馈问题、提出建议，或提交 Pull Request。报告问题时请提供系统、应用与核心版本、复现步骤及脱敏诊断；提交改动前按[开发指南](docs/development.md#自动化检查)完成相关检查。

## 许可证

ClearTier 采用 [GNU LGPL v3.0](LICENSE)。EasyTier 及其他第三方代码、字体和运行资源遵循各自的许可证。

## 致谢

感谢 [Codex](https://openai.com/codex/) 协助创建 ClearTier，参与项目设计、开发与文档编写。

感谢 [EasyTier](https://github.com/EasyTier/EasyTier) 项目及其贡献者。ClearTier 基于 EasyTier 构建，使用其组网核心实现网络连接能力。
