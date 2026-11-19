# What gets installed where

| 位置 | 内容 | 归属 |
| --- | --- | --- |
| `npm -g @agentmemory/agentmemory@0.9.32` | 记忆引擎 + `agentmemory` CLI | 上游包（固定版本） |
| `~/.agentmemory/` | daemon、REST :3111、**你的记忆数据库** | 你的数据，卸载默认保留 |
| `~/.agent-learning/guard/` | `hook-shim.mjs` 稳定入口 + `bin/{guard,policy,session-context}` + `manifest.sha256` + `install-receipt.json` | 本包（路径独立于任何 git checkout） |
| `~/.config/devin/config.json` | 4 条 learning hooks 指向 shim（自动备份 `.bak.agentlearning-*`） | 合并写入，其他条目不动 |
| `~/.config/devin/mcp_config.json` | agentmemory MCP server 条目（由官方 `agentmemory connect devin` 写入） | 上游生成 |
| `~/.config/devin/skills/<7 个>/SKILL.md` | memory-recall, error-triage, self-repair, lesson-distiller, lesson-validator, evidence-verifier, learning-health | 本包 |

## 为什么是稳定路径

历史上 hooks 直接指向 git checkout 里的 `scripts/learning/…`，分支一切换
就 `MODULE_NOT_FOUND → exit 1`（Issue #6）。现在的 shim 在 checkout 之外，
按 `manifest.sha256` 校验完整性，且永远找不到目标时：

- PreToolUse → fail-closed（宁拦不误放，并给出可读原因）
- Stop / SessionStart / 其他 → fail-open + 审计 + `health.json` 降级标记

## 你的配置会被改成什么样

install.sh 只改 4 条 command 字段（或补齐缺失条目），其余 hook、
matcher、timeout、MCP、permissions 原样保留。每次写配置前自动备份，
`rollback.sh` 一键恢复。
