# Capability Matrix — what's real vs experimental

| 能力 | 状态 | 证据 |
| --- | --- | --- |
| Devin 用户级 hooks 全局加载（10 条） | STABLE | host log `loaded=10`，真实会话 |
| AgentMemory daemon + MCP | STABLE | `agentmemory status` healthy，31 sessions/1419 observations（开发机） |
| 跨会话 Lesson 召回影响决策 | STABLE | 多真实会话记录（t02/t03 等） |
| E03 高风险操作阻断 | STABLE | 真实会话 `decision:block` + audit 证据 |
| Stop hook exit-0（原 exit1 修复） | STABLE | PR #7 实机部署验证 |
| 跨 git 分支守卫存活 | STABLE | shim bin/ 兜底 + health.json 实证 |
| 配置原子备份/回滚 | STABLE | install-shim e2e + 实机 .bak |
| 项目间记忆隔离 | STABLE | project-key 作用域测试 |
| 候选 Lesson 提炼（人确认） | STABLE | lesson-distiller skill |
| **自动纠错→自发持久化→复用** | **EXPERIMENTAL** | 未通过端到端验证，Stable 不含 |
| 自动评估复发率下降 | EXPERIMENTAL | 未实现度量管线 |
| macOS arm64 | SUPPORTED | 发行包验证目标 |
| macOS Intel / 其他 OS | NOT_TESTED | 不承诺 |
| Codex / Claude Code / Devin Cloud 全局接入 | UNSUPPORTED | 本包不支持 |
