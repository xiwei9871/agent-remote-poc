# Privacy & Permissions

## 数据留在哪里

- **全部记忆数据只在本机**：`~/.agentmemory/`（daemon REST 仅监听
  `localhost:3111`，viewer `:3113`）。没有跨设备、跨员工共享机制。
- 本包不包含、不读取、不上传他人的记忆库、API key、SSH key 或项目文件。
- `uninstall.sh` 默认**保留** `~/.agentmemory/`（个人数据），`--purge-data`
  才会删除，且会先打印确认提示。

## 安装器请求的权限

| 动作 | 权限 | 说明 |
| --- | --- | --- |
| `npm install -g` | npm 全局目录写权限 | 固定版本 `0.9.32`，非 `@latest`、非浮动 |
| `agentmemory` | 启动本机 daemon | 官方 worker compose，localhost only |
| `agentmemory connect devin` | 写 Devin MCP/hooks 配置 | 上游官方接线命令 |
| 写 `~/.config/devin/` | 你的用户级配置 | 仅合并本包条目，逐条校验 + 备份 |
| 写 `~/.agent-learning/` | 本包工作目录 | 不依赖 `/Users/xiwei`、brew、代理 |

**不做的事**：无 `curl | sudo bash`、无 sudo、不删数据、不按端口杀进程、
不自动批准 Devin 权限弹窗、不读取会话正文（审计只记事件级元数据）。

## Guard 的安全模型

Guard 只对你的 Devin 会话内工具调用生效，规则见 `hooks/policy.json`。
默认稳定启用的是已实测规则（如 E03 广谱 pkill/killall 阻断）；没有真实
证据支撑的规则不进入默认 BLOCK。Guard 自己挂掉时 PreToolUse 采用
fail-closed——宁可拦住让你确认，也不静默放行。

## 端口与记忆隔离边界（重要）

AgentMemory daemon 端口 `3111` 在 0.9.32 中为硬编码，**同一台 Mac 的多
个用户账户共享同一个 daemon 端口**：

- 两个账户无法各自运行独立 daemon（先占用者胜）。
- 若别人的 daemon 正在跑，你账户里的钩默认也会指向 `localhost:3111`
  ——你的记忆会写进对方的库。**同一台 Mac 上请只让一个账户使用本包**。
- 个人记忆数据存在你自己账户的 `~/.agentmemory/`，不跨账户复制、不上传；
  但 daemon 端口是机器级资源，这是上游架构限制，不是本包能改变的。

因此同事真机试装**推荐独立 Mac**；同机测试账户只能与 owner 顺序占用端口
（步骤见 `docs/distribution/INSTALL_UAT.md`）。
