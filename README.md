# Project Zomboid Vault

面向 Windows 的 Project Zomboid Steam 原版与冻结版本管理器。项目从 `pz-version-mod-freezer` 的 PowerShell/WPF 原型演进而来，现在使用 Electron、React 和原生 Node 服务实现桌面工作流。

## 当前功能

- 自动从注册表、`libraryfolders.vdf` 和 AppID `108600` 清单发现 Steam 原版。
- 统一管理 Steam 原版与冻结版本，并持久化当前版本。
- 控制台围绕当前版本提供启动、模组、存档、备份和日志入口。
- 版本卡片与相对版本雷达；雷达支持悬停信息和双击切换。
- 明确的“来源 → 迁移模式 → 名称与目标”冻结版本制作流程。
- 从 Steam 或冻结版执行安全完整复制。
- 创建快速薄版本：直接引用不可变游戏核心，只复制存档与配置，并对当前启用 MOD 使用 NTFS 文件硬链接；跨卷时自动回退复制。
- 生成 SHA-256 基线清单，并提供原生启动与完整性校验。
- 从游戏二进制识别 B42 版本、revision 与 `Core.jar` SHA-256，不再依赖可能过期的 `version.txt`。
- 解析 B42 MOD 版本目录、Workshop/Mod ID、依赖、互斥、加载顺序、重复 ID 和语义文件覆盖。
- 提供统一 MOD 数据库、MOD 中心、版本绑定配置档案和经过依赖校验的安全启用规划器。
- 对 Lua、Java/JAR 与 PZ 脚本做不执行代码的静态证据分析，并建立跨路径脚本实体索引。
- 以最近旧冻结版为基线，对比游戏更新影响到的脚本实体、同路径原版文件和 MOD 实际引用的游戏 Java Class。
- 对比最新存档、服务器配置与实际冻结内容，输出阻断、警告、待验证和通过证据。
- 迁移前可备份 Saves、数据库和根配置。
- 兼容旧 PowerShell 版本生成的带 UTF-8 BOM 的 `freeze.json`。

## 数据安全边界

- Saves、配置、数据库和运行时缓存不会参与硬链接或共享。
- Steam 原版禁止快速硬链接，避免 Steam 更新改变冻结内容。
- 不以“成功启动三次”作为自动删除备份的依据。
- 迁移失败时保留未完成目录用于诊断，不自动删除用户数据。

## 开发

需要 Node.js 22 与 pnpm 9：

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm dev
```

构建 Windows installer 与 portable：

```powershell
pnpm dist:win
```

产物位于 `release/`。

## 当前边界

- `.pzshare` 只传递可审计清单和指纹，不包含游戏文件、MOD、存档或账号数据；接收端必须用本机合法来源重建并验证。
- MOD 规则库会继续扩展，目前已覆盖 `mod.info`、B42 版本层、依赖关系和主要文件语义；无法静态确认的 Lua 运行时行为仍标记为待验证。
- SHA-256 内容寻址共享仓库属于下一阶段。
- Windows 包暂未配置商业代码签名证书，系统可能显示“未知发布者”。

## 来源与许可

产品历史与旧版 PowerShell 实现位于 [xyjo23/pz-version-mod-freezer](https://github.com/xyjo23/pz-version-mod-freezer)。本项目不包含 Project Zomboid 游戏文件、Workshop MOD 或用户存档，也不隶属于 The Indie Stone、Valve 或 Steam。

源代码使用 MIT License；第三方许可见 `THIRD_PARTY_LICENSES.md`。
