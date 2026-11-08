# 架构说明

## 目标

PZ Version & Mod Freezer 将一个可玩的 Project Zomboid 环境保存为独立快照。Steam 原版继续正常更新，快照中的游戏、MOD 和存档保持在创建时的状态。

## 组件

- `PZ-Freezer.ps1`：WPF 图形界面、自动检测、后台任务和多快照切换。
- `tools/PZ-Freeze-Manager.ps1`：复制、启动、校验、备份和恢复核心。
- `tools/Analyze-PZMods.ps1`：B41/B42 版本目录选择、Mod ID、依赖和存档启用列表分析。

## 数据模型

每个 `profiles/<版本标签>` 都是独立快照：

- `game`：完整游戏与自带 Java。
- `cache`：独立缓存、本地化后的 Workshop MOD、配置和存档。
- `manifests`：游戏与 MOD 的 SHA-256 基线。
- `metadata`：来源、BuildID、Mod ID、Workshop ID 和复制映射。
- `reports`：创建、隔离、校验和内存配置报告。
- `backups`：独立存档 ZIP。

根目录的 `current-freeze.json` 只负责指出当前快照，不包含游戏文件。

## 隔离方式

冻结版使用：

```text
ProjectZomboid64.exe -nosteam -cachedir=<快照的 cache 目录>
```

Workshop 内容复制为 `cache/mods` 下的本地 MOD。核心内容使用真实文件复制，不使用符号链接、目录联接或硬链接。

## 创建事务

1. 确认游戏没有运行。
2. 检测 Steam、游戏、Workshop、缓存和版本。
3. 检查链接、磁盘空间、Mod ID 和依赖。
4. 复制游戏和缓存。
5. 把 Workshop MOD 转为快照内本地 MOD。
6. 对来源和副本计算 SHA-256 并比较。
7. 只对冻结副本应用安全 Java 内存上限。
8. 生成最终哈希基线、配置、启动器和初始存档备份。
9. 完成静态隔离验证后才宣布成功。

## 可变与不可变内容

游戏和冻结 MOD 属于完整性基线。存档、配置和日志允许正常变化。JVM 诊断文件 `hs_err_pid*.log` 与 `replay_pid*.log` 不参与完整性比较。

## 增量迁移事务

增量迁移面向已经存在的冻结快照：

1. 快速扫描 Steam 游戏与 Workshop，只比较相对路径、存在性和文件大小。
2. 游戏版本与 BuildID 完全兼容时，补齐缺失的游戏文件；不覆盖已有文件。
3. 按有效 `mod.info` 的 Mod ID 比较，只复制目标中缺少的 Workshop MOD。
4. 阻止重复 Mod ID、缺失依赖和不明确的来源。
5. 备份清单、MOD 映射和快照配置；存档 ZIP 由用户通过独立的“备份存档”操作创建。
6. 仅对新增文件计算 SHA-256，并增量更新游戏/MOD 基线。
7. 在 `migrations/<时间>` 保存新增文件、哈希和元数据备份。

回迁会先重新计算本次新增文件的哈希。任何文件发生后续变化时，整个回迁在删除前停止；没有冲突时才删除本次新增文件并恢复迁移前元数据。

## 安全原则

- 不修改 Steam manifest。
- 不修改原始游戏、Workshop 或原始存档。
- 不覆盖既有快照。
- 不在游戏运行时创建或恢复。
- 恢复操作默认解压到新目录，不覆盖当前存档。
