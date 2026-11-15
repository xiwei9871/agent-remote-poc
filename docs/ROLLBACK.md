# 回滚与清理（无损）

POC 全部内容限制在 `~/agent-hub-poc/` 与本仓 `~/agent-remote-poc/`；未安装全局包、
未创建系统服务/启动项、未修改 `~/.dsh` / `~/.claude` / `~/.codex` / Devin 配置。
回滚 = 停进程 + 删目录。

## 1. 停止进程

```sh
pkill -f "dsh web"
# 确认无残留
pgrep -fl "dsh web|claude-agent-acp|codex app-server" || echo "clean"
```

## 2. 移除 Remote 设备授权（可选但建议）

- 若已完成过 Remote 登录：先在客户端"设备列表"移除本 Host，或在 Remote 设置中
  退出登录，再删 DSH_HOME（凭据吊销优于直接删除）。

## 3. 删除 POC 文件

```sh
rm -rf ~/agent-hub-poc        # DSH 本体、插件、凭据、工作区、证据日志
rm -rf ~/agent-remote-poc     # 本仓本地副本（远端仓库另行决定是否保留）
```

## 4. 确认未影响项

- `~/.claude/`：未修改（POC 只读观察）
- `~/.codex`：不存在/未创建
- `~/.local/bin/`：未改动（`devin` 失效软链是既存状态，非 POC 造成）
- npm 全局：未安装任何全局包（`npm ls -g` 与 POC 前一致）
- launchd/systemd：无新增项
- 浏览器：`dsh web --no-open` 未强制打开页面；Remote Web 无本地残留
