# 全局安装变更清单（Gate 2，需 Owner 逐项批准）

Gate 0/1 均为只读或隔离环境；以下每一项**写入真实用户级配置/常驻进程**，
执行前须获 Owner 明确批准。备份先行：`~/.agentmemory/backups/` +
本仓 `scripts/learning/backup.sh` 另存 `~/.config/devin/config.json` 快照。

| # | 变更 | 位置 | 影响面 | 回滚 |
| --- | --- | --- | --- | --- |
| A | `mcpServers.agentmemory`（stdio `npx @agentmemory/mcp@0.9.32`） | `~/.config/devin/config.json` | 所有新 Session 可见 54 个 memory_* 工具 | `connect devin --remove` 或恢复快照 |
| B | `hooks` 键：agentmemory 6 hooks | 同上 | 每事件 spawn Node 脚本→localhost:3111；SessionStart/UPS 注入上下文 | 快照恢复；hooks 崩坏仅记错不影响会话（fail-open） |
| C | `hooks` 键：本仓 guard hooks（PreToolUse/Stop/PostToolUse/PermissionRequest） | 同上 | E03 类可**阻断**命令；其余 warn | 摘除该 hooks 数组项即失效 |
| D | agentmemory daemon 常驻（localhost:3111/3113） | `~/.agentmemory/` 数据+`.env`+secret | 本地端口 2 个；磁盘 ~数据量；keyless 无外传 | `agentmemory remove`；杀进程+删目录 |
| E | （可选）`EMBEDDING_PROVIDER=local` | `~/.agentmemory/.env` | 首次下载本地 embedding 模型 | 改回 noop 重启 |
| F | （不推荐默认）AGENTMEMORY_LLM_PROVIDER 等外部 LLM 压缩 | 同上 | **会向外部 provider 发送会话摘要**——默认关闭，不批准不启用 | 删 env 行 |

## 明确不做的

- 不启用任何 `*_ALLOW_AGENT_SDK`/外部 LLM provider（除非另行批准 F）。
- 不安装 Devin plugin（plugin 无 SessionStart/SessionEnd 能力且作用域不同）。
- 不动 `~/.claude/`、Codex、Devin 登录态、其他项目配置。
- 不向 GitHub 推送真实记忆/会话原文；测试全用合成数据。

## Desktop / Cloud

- Desktop：预期与 CLI 共享 `~/.config/devin/config.json`（Gate 2 T07 实测；
  若 Desktop 不读该文件则标 `UNSUPPORTED`）。
- Cloud：本地 daemon 不可达 → `UNSUPPORTED`；方案=部署公网/隧道可达
  agentmemory + Devin Secrets `AGENTMEMORY_URL/SECRET` + Cloud MCP 注册，
  需单独批准。
