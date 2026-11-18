# Lesson 模式约定

存储实体用 agentmemory lesson（`memory_lesson_save`）；以下字段写入 lesson
content/metadata 约定层，guard 投影读取同一份。

```json
{
  "lesson_id": "L-2026-0001",
  "scope": "global | project:<repo-canonical-id> | session:<id>",
  "kind": "error | preference | command | decision | rejected-approach | assumption",
  "trigger": { "when": "before exec pkill without pid-file", "tool": "exec", "pattern": "pkill\\s+-f" },
  "wrong_action": "pkill -f 'dsh web' killed other dsh sessions",
  "root_cause": "broad pattern matched non-POC processes",
  "correct_action": "PID file + lsof cwd ownership check",
  "prevention_check": { "type": "regex|command|manual", "expr": "...", "mode": "warn|block" },
  "evidence": ["docs/TEST_RESULTS.md#...", "session:<id>:<ts>"],
  "confidence": "high | medium | low",
  "status": "CANDIDATE | VALIDATED | ENFORCED | REJECTED | REVOKED",
  "supersedes": ["L-2025-0xxx"],
  "version": 3,
  "last_verified": "2026-11-15",
  "source": "user-correction | test-failure | tool-error | review"
}
```

规则：

- `source=user-correction` 直接进 VALIDATED 候选（用户明确纠错优先级最高）。
- `status=ENFORCED` 必须有 `prevention_check` 可执行形式 + 至少一次
  `last_verified` 实测；CANDIDATE/VALIDATED 仅参与召回注入，不产生 block。
- 冲突/过期：新版本 `supersedes` 旧 id，agentmemory 版本链使召回只返回最新；
  REVOKED 立即从 guard policy 投影中剔除。
- scope 分区：repo canonical id = `git rev-parse --git-common-dir` 解析结果
  （worktree 归并同仓）；global 跨项目；session 仅本会话。
- 泄漏控制：project scope 内容不注入其他项目 SessionStart；敏感值不落 lesson
  （写入前 secret scrub——agentmemory 默认开启，Gate 1 实测）。
