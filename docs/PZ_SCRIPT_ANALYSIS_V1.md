# Project Zomboid 脚本语义分析 V1

## 目标

`media/scripts/*.txt` 不是普通文本资源。它们会向游戏的脚本管理器声明 `item`、`recipe`、`vehicle`、`model`、`template` 等实体。V1 不再把“相同相对路径且字节不同”直接等同于冲突，而是比较完整的 `module + 定义头`。

## 解析方法

- 识别一个文件中的全部 `module 名称 { ... }`；
- 读取 module 直接包含的命名定义块，不把定义内部的 `skin`、`part` 等子块误认为独立全局实体；
- 去除空白、单行注释和块注释后，为每个定义生成 SHA-256 语义摘要；
- 摘要保留字段、值和顺序，因为这些内容可能影响游戏行为；
- 额外列出直接属性及子块数量，使报告能说明差异，而不只显示哈希。

## 报告状态

- `script-definition-conflict`（警告）：多个 MOD 声明相同的 module 与定义头，但内容摘要不同；加载顺序可能决定最终实体。
- `script-definitions-identical`（通过）：同名定义的语义摘要一致。
- `script-definitions-disjoint`（通过）：文件路径相同，但没有跨 MOD 同名实体定义。
- `script-unparsed`（待验证）：文件无法读取、超过 8 MiB、注释/字符串/大括号不完整，或 module 顶层包含无法归类的内容。解析不完整时不会推断冲突。

## 真实样本

2026-11-27 的启用组合只有一个不同内容的 PZ 脚本同路径项。分析确认：

- `ATA_VanDeRumbaGardenia` 与 `ATA_VanDeRumbaGardeniaSkin` 都声明 `Base.vehicle ATA_VanDeRumbaGardenia`；
- 主 MOD 包含 8 个 `skin` 子块；皮肤包包含 13 个；
- 这是有明确实体证据的定义差异，符合皮肤扩展补丁特征，应按作者要求让皮肤包后加载并在测试存档检查车辆外观。

## 后续能力

同路径语义分析之外，兼容性服务现已通过独立的全局实体索引检查不同文件路径中的同名定义，详见 `PZ_SCRIPT_GLOBAL_INDEX_V1.md`。分析过程不会写入、格式化或执行任何 MOD 文件。
