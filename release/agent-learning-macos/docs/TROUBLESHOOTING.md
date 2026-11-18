# Troubleshooting

| 症状 | 先看 | 常见处理 |
| --- | --- | --- |
| `RESULT: FAIL` on doctor | FAIL 行文本 | 按行内指引修；bundle hash 不符 → 重跑 `./install.sh` |
| `agentmemory daemon not reachable` | `agentmemory status` | 运行 `agentmemory` 启动 daemon（无需 sudo），再 `./doctor.sh` |
| 新会话没有记忆注入 | `health.json`、`~/.config/devin/config.json` hooks | 确认 4 条 shim 命令存在；`./doctor.sh` 第 6 组检查 |
| Devin 出现 `hook failed ... exit 1` | `cat ~/.agent-learning/guard/health.json` | health=ok 则本包 hook 正常——该 WARN 是 Devin 未归因告警（见下） |
| 想完全恢复原状 | — | `./rollback.sh`（恢复配置）→ `./uninstall.sh`（删本包文件） |
| 装完 skills 没出现 | Devin 会话内 `/<name>` | skills 需新开 Devin 会话才被发现 |

## 已知限制（如实披露）

1. **Devin `hook None exit 1` WARN**：Desktop/CLI 日志里偶发
   `Effects evaluator failed for hook None`，已实测与每次工具调用相关，
   但与本包 10 个 hook 无关（全部 exit-0 契约 + 运行证据）。上游未归因，
   跟踪于内部 Issue #8。doctor 会报告 WARN 计数但标 `PART`，不是本包故障。
2. **自动学习**：`lesson-distiller` 只产出候选 Lesson 草稿供你确认；
   "纠错→自动持久化→跨会话复用" 的闭环尚未通过端到端验证，是实验功能。
3. **平台**：仅验证 macOS arm64 + Node≥18 + Devin。Intel/其他 agent
   未测试，不承诺。
4. **E05 远端 SHA 门禁**：在无 `cwd` 的事件上只能做到形状级验证，
   不替代 `git ls-remote` 人工核验。

## 获取帮助

把 `./doctor.sh` 的完整输出和 `~/.agent-learning/guard/audit.jsonl`
末尾 20 行发给分发者——两份信息足够定位 95% 的问题。
