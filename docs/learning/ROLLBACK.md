# 回滚

分层，从快到彻底：

1. **停用 guard（保留记忆）**：`~/.config/devin/config.json` 的 `hooks`
   中删除本仓 guard 数组项（标记注释 `// agent-learning` 段），即刻生效，
   agentmemory 捕获不受影响。
2. **停用全部 hooks**：恢复 `config.json` 备份
   （`~/.agentmemory/backups/devin-hooks-*` 或 `scripts/learning/backup.sh`
   快照）。
3. **停 daemon**：`pkill -f agentmemory`（此处精确匹配二进制名可接受，
   另有 `agentmemory stop`）；端口释放即完成。
4. **彻底卸载**：`npx @agentmemory/agentmemory@0.9.32 remove`（官方卸载器，
   清除其创建的 config 项与 daemon），再 `rm -rf ~/.agentmemory`；
   本仓侧无其他系统足迹。
5. **隔离环境（Gate 1）**：`rm -rf $ISO_HOME`，零系统影响。

不变量：不碰 `~/.claude/`、Codex、登录态、其他项目；`config.json` 备份
先验证可读再写入。所有备份与回滚步骤 Gate 1 在隔离环境先演练一次。
