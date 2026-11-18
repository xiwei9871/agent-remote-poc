# Hook 事件矩阵（Devin CLI 3000.12.59）

`DOC`：docs/extensibility/hooks/lifecycle-hooks.mdx；`STATIC`：agentmemory
0.9.32 tarball `plugin/hooks/hooks.devin.json` + `dist/hooks/*.mjs`。
Gate 1 将逐项 `ACTUAL_RUN` 标注触发日志。

| 事件 | stdin 关键字段 | Devin 输出能力 | agentmemory 用法 | 本系统用法（guard） |
| --- | --- | --- | --- | --- |
| SessionStart | `source` | additionalContext 注入；本地可 block | 召回项目上下文注入（≤budget） | 注入全局规则索引+guard 生效清单 |
| UserPromptSubmit | `prompt` | additionalContext | 按 prompt 召回相关 lesson/记忆注入 | （沿用 agentmemory 注入） |
| PreToolUse | `tool_name`,`tool_input` | block / approve / updatedInput / context | 捕获+注入相关记忆（matcher: `^(exec\|edit\|write\|read\|apply_patch\|grep\|glob)$`） | **确定性门禁**：E01 自动批准、E03 误杀、E05 未核验交付等 → block |
| PostToolUse | `+tool_response{success,output,error}` | context 注入 | 捕获观察（matcher:""） | 记录证据事件（供 E02/E04 校验） |
| PermissionRequest | `tool_name`,`tool_input` | approve/deny 决策 | （未用） | 正向白名单：默认不自动批准权限扩大类 |
| Stop | `stop_hook_active` | block（可强制继续） | telemetry 捕获 | **交付校验门**：E02 FAIL→exit0、E04 假PASS、E05 SHA 未核验 → block/警告 |
| PostCompaction | `summary` | context 注入 | （agentmemory 另有 pre-compact skill） | 压缩后重注入关键 lesson 索引 |
| SessionEnd | `reason` | —（仅本地） | 会话收尾捕获 | 轻量 consolidation（候选 lesson 落库） |

## 加载位置（用户级 = 本任务目标）

`~/.config/devin/config.json` → `"hooks"` 键（XDG 尊重；Windows `%APPDATA%`）。
项目级 `.devin/hooks.v1.json` 与 `.claude/` 兼容路径同样生效，但**不要求**——
全局靠用户级一条。`read_config_from.claude` 默认开启也会读
`~/.claude/settings.json` 的 hooks（当前用户文件无 hooks 键，已核实）。

## 关键语义（门禁设计依赖）

- exit `2` = block；其他非零 = 记错放行（fail-open）。guard 决策走 stdout JSON。
- `session_id` 稳定/会话，`prompt_id` 每轮轮换——可用于跨 hook 关联证据。
- `DEVIN_PROJECT_DIR` = 项目根（hook 进程环境）。
- Cloud：SessionStart 后台跑、decision 忽略；SessionEnd 不触发 → 本地门禁
  不等价云端，云端列 UNSUPPORTED。
- agentmemory PreToolUse matcher 不含 `kill_shell`/`request_scope` 等工具——
  E03（误杀进程）类 guard 需本仓 matcher 覆盖 `exec|kill_shell` 全集。
