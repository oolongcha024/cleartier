# 应用版本管理

`package.json.version` 是 ClearTier 应用版本的唯一人工维护入口，通过版本脚本更新；不要分别修改 Rust 或 Tauri 版本。Tauri 配置引用 `../package.json`，浏览器界面直接读取包版本，Rust 应用包及其锁文件由脚本同步。`cleartier-core`、`cleartier-config` 是内部 crate，保留各自版本；EasyTier 内核版本仍由实际内核读取。

## 推进命令

例如从正式版 `0.1.0` 开始一次功能版本：

```sh
pnpm version:start minor alpha --dry-run # 预览 0.2.0-alpha.1，不修改文件
pnpm version:start minor alpha           # 0.2.0-alpha.1
pnpm version:next                        # 0.2.0-alpha.2
pnpm version:promote beta                # 0.2.0-beta.1
pnpm version:next                        # 0.2.0-beta.2
pnpm version:promote rc                  # 0.2.0-rc.1
pnpm version:promote stable              # 0.2.0
```

| 命令 | 作用 |
| --- | --- |
| `pnpm version:start patch` | 当前基础版本的补丁号加一，默认从 `alpha.1` 开始 |
| `pnpm version:start minor beta` | 次版本号加一，从 `beta.1` 开始 |
| `pnpm version:start major rc` | 主版本号加一，从 `rc.1` 开始 |
| `pnpm version:start patch stable` | 直接推进到下一个正式补丁版本 |
| `pnpm version:next` | 当前预发布序号加一，例如 `beta.9 → beta.10` |
| `pnpm version:promote beta/rc/stable` | 进入更晚的阶段；允许跳过阶段，进入新阶段时序号从 1 开始 |
| `pnpm version:set 0.3.0-beta.1` | 显式设置更高版本，仍执行全部格式、单调递增和标签校验 |
| `pnpm version:check` | 检查版本格式、Rust 同步和 Tauri 引用，不修改文件 |

所有修改命令均支持 `--dry-run`。脚本不提交代码、不创建标签、不推送。版本是 `X.Y.Z` 或 `X.Y.Z-alpha.N`／`beta.N`／`rc.N`，`N` 为正整数。禁止 `v` 前缀、前导零、自定义阶段和 `+build` 元数据；提交 SHA 与构建时间在 Windows `build-info.json` 中记录。

`start` 总是先增加基础版本，再选择阶段：从 `0.2.0-alpha.5` 执行 `start minor` 得到 `0.3.0-alpha.1`。同一目标版本继续测试应使用 `next` 或 `promote`。正式版 `0.2.0` 不能变回 `0.2.0-alpha.1`；回退阶段、重置同阶段序号、重复版本都会失败。

## 如何选择版本

- `alpha`：早期验证，功能和行为仍可能变化。
- `beta`：主要功能已具备，扩大测试范围并修复问题。
- `rc`：发布候选，按正式交付要求验证；发现问题后增加 rc 序号。
- 正式版：完成验证后移除预发布后缀，交付给稳定版本用户。

当前处于 `0.x`：兼容性修复使用 patch，新功能或不兼容行为变化使用 minor。到 `1.0.0` 后遵循 SemVer：兼容修复升 patch，兼容功能升 minor，外部可见契约的不兼容变化升 major。内部重构的工作量不直接决定版本号；根据用户行为、持久化数据、接口及兼容性变化判断。

## 开发、构建与 CI

`pnpm dev`、`pnpm build` 和 Windows 构建先检查一致性，只读取版本。Tauri 的开发／构建钩子使用相同命令；直接执行 Cargo 时，构建脚本也会检查 Rust 应用版本与 `package.json` 相同。浏览器独立预览入口仍是 `http://10.126.179.2:5173`。

版本修改一次同步 `package.json`、`src-tauri/Cargo.toml` 和 `src-tauri/Cargo.lock` 中的应用条目。独占 `.version.lock` 阻止脚本并发写入，校验全部通过后才替换文件，写入失败时恢复已替换文件。多文件操作无法保证进程被强制终止时的整体原子性；中断后先检查三个文件及遗留的 `*.version-*.tmp`，确认没有版本脚本运行，再恢复一致状态并删除 `.version.lock`，重新运行 `pnpm version:check`。不要在升版过程中启动构建。

PR CI 将当前版本与目标分支的精确提交比较；普通代码修改允许版本不变，版本变化必须严格向前。推送检查使用推送前的提交作为基线。两种工作流都拉取完整历史及标签。也可手动运行：

```sh
pnpm version:check --base <提交或分支>
```

首次接入版本管理时，如果基线尚未配置 `version:check`，允许将未发布的正式版占位号初始化为相同基础版本的预发布号；已发布标签仍会阻止回退。当前初始候选版本为 `0.1.0-rc.1`。接入之后的常规升版命令与 CI 比较仍要求版本严格前进。

脚本检查本地 `v<SemVer>` 标签，候选版本必须高于同一 `MAJOR.MINOR` 版本线上的已发布标签。不同版本线可独立维护，例如发布 `0.2.0` 后仍可维护 `0.1.1`。本地升版前先同步远端标签：

```sh
git fetch --tags
```

发布时先提交版本与实现，完成校验，然后在该提交创建 `v0.2.0-rc.1` 等标签。已发布标签不可移动或复用；应在托管平台配置标签保护，限制删除和强制更新。脚本只读取标签，无法替代服务端保护。

```sh
pnpm version:check --release v0.2.0-rc.1
```

发布校验要求标签恰好等于 `v` 加应用版本、标签指向 HEAD、工作区干净（包含未跟踪文件）。GitHub Actions 从标签构建时自动执行同样检查。历史标签可在干净的原提交重新构建；分支构建作为测试产物，不要求版本必须变化。Windows 构建清单包含完整版本、阶段和提交信息，构建结束再次检查版本没有被修改。

Windows 数字文件版本无法表达完整的 alpha／beta／rc 顺序；比较预发布版本应使用完整 SemVer。当前没有引入自动更新器；未来更新策略应按渠道过滤：稳定渠道只接收正式版，预发布渠道按明确策略接收候选版本。
