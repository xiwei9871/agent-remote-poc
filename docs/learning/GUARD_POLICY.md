# 错误防复发门禁策略（合成五案 → 可执行判定）

五类历史错误的防御分级。诚实声明：语义性"假 PASS"无法仅靠 shell 正则绝对
阻断——分级为 hard-block / CI-verify / warn-shadow。

| # | 错误模式 | 防御层 | 判定 | 机制 |
| --- | --- | --- | --- | --- |
| E01 | 测试/探针默认 `allow_once` 自动批准危险操作 | PreToolUse + 静态检查 | **hard-block（写代码时）+ warn（运行时语境）** | guard 检测写出的脚本含"优先选择 allow/approve 分支且无人工确认门槛"模式 → block；PermissionRequest 对权限扩大类默认不批 |
| E02 | 测试 FAIL 仍 `exit 0`/记 PASS | Stop + CI | **CI-verify + Stop warn** | guard 在 Stop 时核对本轮测试输出含 fail/FAILED 而收尾称"通过"→ block 要求说明；`scripts/learning/guard-runner` 供 CI 强制 |
| E03 | `pkill -f` 通用名误杀非目标进程 | PreToolUse | **hard-block** | exec/kill_shell 命令匹配 `pkill|killall` 且无 PID 文件/归属校验参数 → block，提示改用 PID+归属校验 |
| E04 | 未真实执行把 STATIC/BLOCKED 标端到端 PASS | Stop/PostToolUse + CI | **warn-shadow（首轮）→ 成熟后 block** | 证据核对：报告含 PASS 而无对应 ACTUAL_RUN 证据文件 → warn/block；CI guard-runner 扫报告/证据一致性 |
| E05 | 未 push/未 `ls-remote` 核验即称交付完成 | Stop + PostToolUse | **hard-block（对"已完成"表述）+ CI** | Stop 时若本轮有 `git push` 痕迹而无 `ls-remote`/`gh api` 核验记录 → block 要求补验；CI 校验远端 SHA=本地 HEAD |

## 运行模式

- `WARN`/`SHADOW`（默认首轮）：只记录命中+提示，不阻断，收集误报样本。
- `BLOCK`：E03 等确定性模式直接启用；E02/E05 在证据信号清晰后启用；
  E04 保持 warn→人工裁决。
- Fail-open 说明：hook 非 2 退出只记错放行（Devin 语义）；门禁脚本自身
  崩溃不得阻断正常开发——所有 guard 输出审计日志 `~/.agentmemory/../guard/`。
- 正向白名单：guard 只拦截明确匹配的高危模式，不越权放行其他操作；
  `PermissionRequest` 不代用户做批准（approve 仅限显式 allowlist）。

## Lesson → 门禁投影

`ENFORCED` 状态 lesson 的 `prevention_check` 若为可执行形式
（regex/command），编译进 `guard/policy.json`；CANDIDATE/VALIDATED 只进
召回索引不产生阻断。无证据自动生成"永不再犯"规则 = 禁止项（自检）。
