# 回滚

分层，从快到彻底：

1. **停用 guard（保留记忆）**：`~/.config/devin/config.json` 的 `hooks`
   中删除本仓 guard 数组项（标记注释 `// agent-learning` 段），即刻生效，
   agentmemory 捕获不受影响。
2. **停用全部 hooks**：恢复 `config.json` 备份
   （`~/.agentmemory/backups/devin-hooks-*` 或 `scripts/learning/backup.sh`
   快照）。
3. **停 daemon**：`agentmemory stop`（官方命令，唯一自动路径）。若失败：
   人工核身后逐个终止——`pgrep -fl agentmemory` 列出候选，对每个 PID 用
   `lsof -p <pid> -d cwd` 确认其可执行文件/工作目录确属 AgentMemory 安装
   （`~/.agentmemory` 或全局 npm 目录），再 `kill <pid>`。**禁止任何
   按端口或 `-f` 模式自动批量终止**（`lsof -ti tcp:3111` 可能命中连接该
   端口的客户端进程；`pkill -f` 匹配整条命令行，见 E03）。
4. **彻底卸载**：`npx @agentmemory/agentmemory@0.9.32 remove`（官方卸载器，
   清除其创建的 config 项与 daemon），再 `rm -rf ~/.agentmemory`；
   本仓侧无其他系统足迹。
5. **隔离环境（Gate 1）**：`rm -rf $ISO_HOME`，零系统影响。

不变量：不碰 `~/.claude/`、Codex、登录态、其他项目；`config.json` 备份
先验证可读再写入。所有备份与回滚步骤 Gate 1 在隔离环境先演练一次。
