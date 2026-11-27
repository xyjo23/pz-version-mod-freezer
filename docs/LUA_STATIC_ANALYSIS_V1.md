# Lua 静态语义分析 V1

## 目标

兼容性分析不再把“多个 MOD 中出现相同 Lua 相对路径”直接当成冲突。Project Zomboid 会从各 MOD 加载脚本，同名路径只是需要进一步检查的入口。V1 在不执行任何 Lua 的前提下，寻找可以复核的语义证据。

## 当前读取的证据

- `require "module"` 与带括号的等价写法；
- `Events.<事件>.Add/Remove(...)` 静态挂接；
- 表字面量之外的全局变量、函数或表成员写入；
- `*.register("静态键")` 形式的直接注册；
- `local X = { type = "..." }` 后通过 `table.insert(注册表, X)` 加入的带类型定义；
- 去除注释和空白后的表定义摘要，用于区分“同名同内容”与“同名不同内容”。

字符串、单行/长注释和表字段不会被当成全局写入。`Namespace = Namespace or {}` 这种常见的共享命名空间初始化也不会被误报为覆盖。

## 报告状态

- `lua-symbol-conflict`（警告）：确认多个 MOD 写入同一全局符号，或用不同内容注册同一个静态键。
- `lua-registration-repeat`（待验证）：多个 MOD 重复注册同一个键且静态内容一致；是否幂等仍由游戏注册表决定。
- `lua-static-disjoint`（待验证）：没有发现共同全局写入或同名静态注册，但动态分支仍可能影响运行结果。
- `lua-unparsed`（待验证）：文件无法读取、超过 8 MiB 上限、字符串/长注释未闭合或超过令牌上限；不从不完整证据推断冲突。

## 安全边界

分析器不启动 Lua VM，不调用游戏 API，不提取或改写 MOD，不修改 Steam、Workshop、存档或服务器配置。反射式索引、运行时拼接键、`loadstring`、条件分支实际走向以及注册表对重复项的具体处理，仍需通过测试存档和 `console.txt` 验证。

## 2026-11-27 真实只读样本

- 当前启用范围的 22 个 `media/registries.lua`：定位 229 个静态注册和 3 个动态注册，没有发现跨 MOD 同名静态注册；保持待验证，不误报冲突。
- `IrisEyot`、`HavenFall`、`Sector-7 Breach` 的 `ALICEPacks_HotbarAttachDefinition.lua`：确认 `AZWebbingLeft` 与 `AZWebbingRight` 两个类型由多个 MOD 以不同内容注册，报告为警告并列出具体注册键。
