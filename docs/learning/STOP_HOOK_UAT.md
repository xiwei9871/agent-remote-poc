# STOP-HOOK-EXIT1 UAT — 验收记录（Issue #6 Gate 2）

## 已执行（本机实测）

| # | 项 | 结果 |
|---|---|---|
| 1 | 合成复现：`node <缺失路径>` | `MODULE_NOT_FOUND` → **exit 1**，与 Host 日志 `exited with code 1` 形状一致 ✔ |
| 2 | `guard.test.mjs`（含新增缺失/损坏 policy 用例） | **17/17 pass** ✔ |
| 3 | `hook-shim.test.mjs`（新） | **6/6 pass** ✔ |
| 4 | E2E A：shim→真 guard，`pkill -f` 事件 | `decision:block` E03 原样透传、exit 0、审计落盘——**高危阻断未削弱** ✔ |
| 5 | E2E B：模拟分支切换（repo-root→空目录） | exit 0、无 stderr 崩溃、审计 `shim:target-missing` ✔ |
| 6 | E2E：子进程 exit 1 + stderr | exit 0、stdout `PARTIAL` 透传、`child-error` 审计含 stderr 截断 ✔ |
| 7 | argv 路径穿越 / 空 stdin | exit 0 + `bad-argv` 审计 / exit 0 ✔ |

命令（可复现）：
```bash
node --test scripts/learning/guard/guard.test.mjs
node --test scripts/learning/guard/hook-shim.test.mjs
# E2E：
cp scripts/learning/guard/hook-shim.mjs /tmp/shim-e2e/guard/
echo /tmp/al-fix > /tmp/shim-e2e/guard/repo-root
echo '{"session_id":"e2e","hook_event_name":"PreToolUse","tool_name":"exec","tool_input":{"command":"pkill -f x"}}' \
 | AGENT_GUARD_DIR=/tmp/shim-e2e/guard node /tmp/shim-e2e/guard/hook-shim.mjs scripts/learning/guard/guard.mjs
```

## 实机取证（证据见 evidence/stop-exit1/）

- `devin_20261116-111927_68806.log`：04:10:57Z 起大量
  `Effects evaluator failed for hook ... exited with code 1`。
- `audit.jsonl` 断流于 04:09:13Z —— 失败期间脚本未运行（无审计写入）。
- reflog 证实分支切换发生于两者之间。

## 待 Owner 批准后执行（如实标注）

| 项 | 状态 |
|---|---|
| `install-shim.sh --apply` 改 `~/.config/devin/config.json` | **NEEDS_OWNER_CONFIG_APPROVAL**——跨机全局配置，已打印 diff，未执行 |
| 两个全新 Devin Session 真实 Stop 验收 | **OWNER_DESKTOP_UAT**——需 config 生效后实测 |
| Lesson 自动入库（`memory_lesson_save` 由 agent 自主触发） | **AUTO_LESSON_CAPTURE_NOT_VERIFIED**——候选 Lesson 已按 schema 写好，未人工 REST 入库冒充 |

## 不削弱安全边界声明

- E03 `decision:block` 走 stdout JSON 契约，shim 原样转发（E2E A 实测）。
- shim 不改变任何规则裁决；仅在"进程级异常"时把"Host 报错"换成"审计
  +放行"。E05 `pushed-not-verified` 判定逻辑零改动。
- 回滚 = 改回 config 路径 + 删 shim 两文件（RCA §回滚）。
