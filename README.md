# PZ Version & Mod Freezer

这是一个面向 Windows 和 Project Zomboid 的便携式版本冻结工具。它可以把指定时刻的游戏本体、Workshop MOD、加载配置和存档复制到 Steam 管理范围之外，形成可独立启动、校验和备份的完整游戏环境。

> Independent, verifiable snapshots of Project Zomboid, Workshop mods, configuration and saves for Windows. No installer or administrator rights required.

## 下载

普通玩家请从 [Releases](https://github.com/xyjo23/pz-version-mod-freezer/releases/latest) 下载最新 ZIP。解压后先进入唯一的版本文件夹，里面是 `PZ-Freezer.exe` 和 `PZ-Freezer-Files` 程序文件夹；双击 EXE。不要移动或单独复制 EXE。程序文件夹内保留 `PZ-Freezer.cmd` 作为兼容入口。

Release 同时提供 SHA-256 校验文件。当前 EXE 尚未使用商业代码签名证书，因此 Windows 仍可能显示“未知发布者”或 SmartScreen 提醒；只有受信任的 Authenticode 证书才能从根本上消除此提示。不要安装来历不明的证书，也不要把自签名伪装成可信发布者。应用内“使用说明”不会再调用 `.md` 文件关联。

## 快速开始

1. 退出 Project Zomboid。
2. 双击 `PZ-Freezer.exe`。
3. 确认工具自动检测到游戏、Workshop 和存档目录。
4. 点击“**一键创建冻结版本**”。
5. 等待复制、MOD 预检和 SHA-256 校验全部完成。
6. 以后从工具中的“启动当前冻结版”进入冻结环境。

创建过程不会修改 Steam 原版，但需要足够的磁盘空间，耗时取决于游戏、MOD 和存档文件数量。

## 主要功能

- 自动检测 Steam 库和 Project Zomboid（AppID 108600）。
- 支持手动指定游戏、Workshop 和缓存/存档目录。
- 检查存档启用的 MOD ID 和依赖关系。
- 将游戏、MOD、配置和存档复制为独立快照。
- 使用 `-nosteam` 和独立 `-cachedir` 启动。
- 为游戏与 MOD 生成 SHA-256 基线并执行完整校验。
- 选择具体存档并备份到用户指定的外部目录。
- 支持多个版本快照及“设为当前”。
- 根据物理内存为冻结副本设置保守的 Java 最大堆；不会修改 Steam 原版。
- 检查 Steam/Workshop 与当前冻结版之间缺失的游戏文件和 Mod ID。
- 只补齐缺失内容，不覆盖冻结版已有文件。
- 保存最近一次迁移事务，并支持安全回迁。
- 用清晰的“当前步骤 / 下一步 / 结果 / 用时 / 错误原因”代替底层复制输出。
- 在应用内阅读使用说明，不再依赖 Windows 的 `.md` 文件关联。
- 默认使用自动迁移：已有有效冻结文件时增量迁移，空目录时首次完整迁移。
- 通过“自动迁移 / 备份存档”下拉模式分离不同工作流。
- 建立跨目录版本库，选择任意健康冻结版本后直接启动、校验或打开目录。

## 版本库启动器

“2. 版本库与迁移位置”会扫描程序内的 `profiles`、当前冻结版本以及用户添加的其它版本目录。添加的扫描目录保存在本机 `version-library.json`，Release 不会预置个人路径。

版本列表显示游戏版本、Steam BuildID、MOD 数量和健康状态。选择版本后可以：

- “启动所选”：自动设为当前版本，然后使用该版本独立的游戏与 `cache` 启动。
- “校验所选”：使用该版本的 SHA-256 基线进行完整校验。
- “打开目录”：打开实际冻结目录。
- “设为当前”：让迁移和存档备份功能改用该版本。

扫描会自动修正移动过的版本路径，并检查游戏 EXE、独立缓存和游戏清单。为避免误扫整个磁盘，新增版本目录最多向下扫描 6 层，且不允许直接把磁盘根目录加入版本库。

## 增量迁移新 MOD

当你在 Steam 创意工坊下载了新 MOD 后：

1. 完全退出 Project Zomboid。
2. 点击“选择位置”，选择已有冻结版本或一个空目录。
3. 可以选择包含 `current-freeze.json` 的旧管理器目录，也可以直接选择包含 `game`、`cache` 和 `metadata\freeze.json` 的具体快照目录。
4. 点击“检测目标”：已有有效冻结文件时自动选择增量迁移；空目录时自动选择首次完整迁移。
5. 点击“检查迁移内容”。
6. 查看缺失游戏文件、大小不一致文件和缺失 Mod ID 数量。
7. 点击“开始自动迁移”并确认提示。
8. 进入游戏后通过游戏界面为新档或指定存档启用 MOD。

如果所选上级目录中只有一个冻结快照，工具会自动识别；如果包含多个快照，会要求进入并选择具体版本目录。非空但不是有效冻结版的目录会被阻止，避免覆盖无关文件。

迁移采用快速比较：检查相对路径、文件是否存在及文件大小，不对所有已有文件重新计算 SHA-256。只有本次新增文件会计算 SHA-256 并增量写入基线，因此速度通常远快于完整校验。

工具不会覆盖已经存在的冻结文件。若 Steam 游戏版本或 BuildID 与冻结版不同，将跳过游戏文件补齐，只迁移能被目标游戏版本识别的缺失 MOD。重复 Mod ID、缺失依赖或目标冲突会阻止自动迁移。

迁移会在快照的 `migrations` 目录保存轻量事务，但不会自动压缩整个存档。需要存档快照时请单独点击“备份存档”。点击“回迁最近一次”时，工具只删除该事务新增且哈希未发生变化的文件，然后恢复迁移前的元数据和基线。若新增文件后来被修改，回迁会停止，不会强制删除。

注意：文件和版本检查通过不代表 MOD 一定兼容已有存档。地图、世界生成、车辆和大型脚本 MOD 仍可能要求新档。

## 精确备份存档

在“3. 执行操作”中选择“备份存档”，再选择一个具体存档和外部保存目录。工具只压缩该存档目录，并生成内置清单、外部 JSON 摘要与 ZIP SHA-256。

存档内部的地图分块、角色数据库、车辆、世界状态、MOD 状态和 `mods.txt` 会完整保留。工具不会擅自删除其中的文件：The Indie Stone 支持人员建议直接压缩所选存档文件夹，并明确指出删除地图分块会丢失对应区域的进度。参见 [官方论坛的备份建议](https://theindiestone.com/forums/topic/34807-game-freezing/) 和 [分块文件说明](https://theindiestone.com/forums/topic/25840-system-crash-messing-with-backup-save/)。

不会放入 ZIP 的内容包括其它存档、已本地化 MOD 资源、日志、录像、Workshop 缓存以及全局按键和画面设置。这些内容不是恢复该存档世界所必需的。

## 目录结构

```text
<解压目录>\
└─ PZ-Version-Mod-Freezer-<版本>\         解压后进入此文件夹
   ├─ PZ-Freezer.exe                     推荐入口
   └─ PZ-Freezer-Files\                  程序文件夹，请勿与 EXE 分离
      ├─ PZ-Freezer.cmd                  兼容入口
      ├─ PZ-Freezer.ps1                 图形界面
      ├─ assets\                        原创图标
      ├─ tools\                         冻结核心和 MOD 分析器
      ├─ profiles\                      兼容旧版的本地快照索引
      ├─ logs\                          操作日志
      ├─ current-freeze.json            当前选中的快照（迁移后出现）
      └─ version-library.json           用户添加的版本扫描目录（运行后出现）
```

每个快照包含：

```text
game\        冻结游戏本体
cache\       独立配置、MOD 和存档
manifests\   SHA-256 基线
metadata\    版本、BuildID、MOD 映射和来源记录
reports\     创建、校验和运行环境报告
backups\     存档 ZIP 备份
```

## 安全边界

工具不会：

- 修改或锁定 Steam 的 `appmanifest_108600.acf`。
- 伪造 Steam 游戏版本。
- 在冻结目录与 Steam 目录之间建立符号链接、目录联接或硬链接。
- 覆盖已有版本快照。
- 修改 Steam 原版的 Java 内存配置。

请不要手工删除或覆盖 `profiles` 内的文件。Steam 版和冻结版应分别使用各自的入口和存档目录。

## 系统要求

- Windows 10/11 64 位。
- Windows PowerShell 5.1。
- 已安装 Steam 版 Project Zomboid。
- 目标盘可用空间至少为游戏、Workshop MOD 和缓存总大小的 115%。

## 当前版本

项目版本：`0.5.0-preview`

这是根据一次 B42.21.0、154 个 Workshop 项目和 189 个存档 MOD 的真实迁移整理出的首个可运行版本。

## English quick start

1. Exit Project Zomboid.
2. Download and extract the latest release ZIP.
3. Run `PZ-Freezer.cmd`.
4. Confirm the detected game, Workshop and cache/save paths.
5. Run **Preflight only**, then click **Create frozen version**.
6. Launch future sessions through **Launch current frozen version**.

The tool copies real files outside `steamapps`; it does not edit or fake Steam manifests. Frozen profiles can consume significant disk space.

## 致谢与来源

本项目的“复制游戏与缓存、把 Workshop MOD 本地化，并使用 `-nosteam` 与独立 `-cachedir` 启动”思路参考了 [PZ-Wiki-Modding/PZ-Backup](https://github.com/PZ-Wiki-Modding/PZ-Backup)。Steam 库自动检测、安全确认和可恢复操作的产品设计也参考了 [mysteriousdev777/steam-update-freezer](https://github.com/mysteriousdev777/steam-update-freezer)。

本仓库没有复制上述项目的源码；实现使用 PowerShell/WPF 独立编写，并采用不同的文件级快照方案。完整归属和许可证说明见 [NOTICE.md](NOTICE.md)。

## 免责声明

这是一个独立社区工具，与 The Indie Stone、Project Zomboid、Valve 或 Steam 没有关联，也未获得其认可。软件按“原样”提供；创建快照前请保留重要存档的额外备份。游戏本体、Workshop MOD 和存档不会包含在本仓库或 Release 中。
