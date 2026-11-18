# Gate 0 基线审计与风险

## 本机现状（ACTUAL_RUN）

| 项 | 值 |
| --- | --- |
| Devin CLI | `3000.12.59`（Devin.app 内置；`~/.local/bin/devin` 是失效软链） |
| 用户配置 | `~/.config/devin/config.json`：model swe-2-max、org_id、permissions.allow 3 条；**无 hooks 键、无 mcpServers**——干净起点 |
| MCP | `devin mcp list` = 空 |
| rules | `CLAUDE`（~/.claude/CLAUDE.md）、`global_rules`（Windsurf）两条 always-on |
| skills | `~/.config/devin/skills/ego-browser` 一个用户级 skill |
| plugins | `devin plugins list` 需登录（当前未登录插件管理；不影响 hooks/MCP 本地路径） |
| `~/.claude/settings.json` | 无 hooks 键（Devin 兼容路径不占位） |
| agentmemory | 未安装；`~/.agentmemory` 不存在 |

## 历史反例对照（STATIC）

`gov-rollout/Spatial-Canvas/skills/project-continuity`：SKILL.md 写"session
start 读取状态文件"——但靠 agent 自觉调用 skill，无 hook 强制 → 典型
"记忆已写入但执行还会犯错"。本设计用 SessionStart hook 确定性注入替代
自觉约定。

## 上游依赖评估（agentmemory 0.9.32 tarball 审查）

- 许可 Apache-2.0；30.4k★、696 commits、仍在维护（2026-11-13 push）。
- 网络面：hook 脚本只访问 `AGENTMEMORY_URL`（默认 localhost:3111；非
  loopback 强制 HTTPS 否则拒发）；daemon 本地 KV（iii-engine state worker），
  无外传遥测证据（`STATIC`：dist 未见遥测端点；`.env` 注释承诺 keyless 零
  LLM）。
- 风险：①daemon 常驻进程（崩溃→hook fetch 失败，fail-open 不阻塞但无记忆）；
  ②npm 包供应链（已锁 0.9.32 + tarball 审查，仍需 Gate 1 完整性 hash）；
  ③`AGENTMEMORY_AUTO_COMPRESS`/LLM provider 若开启会外传（默认关，列批准项 F）；
  ④端口 3111/3113 冲突可能。
- agentmemory hooks 为捕获/注入型，**不含阻断门禁** → 本仓 guard 层补齐
  （minimal extension）。

## 隐私边界

- 默认 keyless：BM25/合成压缩在本地；无任何 session 内容外传。
- secret 自动生成于 `~/.agentmemory/secret`；capture deny 默认排除
  `memory_*` 等自工具。
- 测试仅合成数据；真实记忆不入 Git。
