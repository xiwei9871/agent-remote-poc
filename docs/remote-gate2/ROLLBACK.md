# 回滚（Gate 2 变更集）

## 本轮实际改动

1. `dsh web` 实例重启一次（SIGTERM→nohup 重启；捕获 launch token）。
   回滚：无需——实例已恢复且授权随重启保持。
2. Host 获得 `server-credentials.json`（注册码授权产物）。
   回滚：`settings.logout`/删除
   `~/agent-hub-poc/dsh-home/ds-harness-remote/servers/e9988d504cda7c1541adafcc/host/server-credentials.json`
   后重启 → 回到 ACCOUNT_AUTH_REQUIRED 状态。
3. 配对会话临时文件：过期自动清除（load() 超 expiresAt+5min 删除）。
4. 文档/证据：git 分支 `research/dsh-remote-gate2-v02`，合并前随时可弃。

## 不影响项

- 不改 `cordis.patch.yml`、不升级 0.6.5、不动 Codex/Claude/Devin 配置。
- Agent Learning V1 冻结分支/配置零触碰。
