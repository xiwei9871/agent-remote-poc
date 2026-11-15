# 配置说明（脱敏模板）

## DSH_HOME 布局（POC 隔离）

```
~/agent-hub-poc/
├── runtime/      # npm 本地安装 @deepseek-ai/dsh@0.2.2-rc.1（非全局）
├── dsh-home/     # DSH_HOME（隔离；默认是 ~/.dsh）
│   ├── profiles/web/cordis.patch.yml   # 用户覆盖层（见下）
│   ├── profiles/web/node_modules/      # profile 插件（pnpm 管理）
│   ├── ds-harness-remote/servers/      # Remote 设备凭据目录
│   ├── .credentials.yaml               # DSH 凭据（浏览器会话 secret）
│   ├── logs/ds-harness-remote/host.log # Remote 插件日志
│   └── storages/workspace.json         # DSH 工作区注册表
├── tools/        # claude-agent-acp / codex 本地安装
├── workspaces/   # 测试工作区（buggy-cli 等）
└── evidence/     # 日志与探针输出（不入库）
```

## cordis.patch.yml（实际使用，路径已脱敏为 $POC）

```yaml
# 注意：entry config 为整体替换语义（非深合并），serverUrl/role 必须重述。
- id: ds-harness-remote
  config:
    serverUrl: https://dsh.r2049.cn
    role: host
    terminal:
      enabled: false          # POC 约束：远程终端默认关闭
    codex:
      binary: $POC/tools/node_modules/.bin/codex
    acp:
      enabled: true
      backends:
        - id: claude
          enabled: true
          command: $POC/tools/node_modules/.bin/claude-agent-acp
        - id: opencode
          enabled: false
        - id: pi
          enabled: false
        - id: antigravity
          enabled: false
```

## 可配置项（取自插件 dist/config.d.ts，静态核对）

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | true | 插件总开关 |
| `role` | `host` | `host`/`client`/`both` |
| `serverUrl` | 托管 `https://dsh.r2049.cn` | 自托管需 `httpServerAllowlist` 才允许 http |
| `deviceName` | hostname | Host 显示名 |
| `terminal.enabled` | true | 远程交互终端（以 Host 用户运行，独立于 Agent 审批） |
| `remoteTools.enabled` | true | `remote_*` 会话工具注入 |
| `hostControl.enabled` | — | Host 控制 |
| `loopback.ports` | — | 本地开发服务预览端口白名单 |
| `forceRelay` | false | 强制走 Relay（禁用 P2P 探测） |
| `rotatePinnedPeerKey` | false | 同账号设备换钥时是否轮换信任 |
| `logLevel` | info | debug 排障用 |
| `reconnect` | 4s→30s 退避 | 断线重连策略 |
| `codex.{enabled,binary}` | true / `codex` | Codex App Server 后端 |
| `cursor.{enabled,binary}` | false / `agent` | Cursor 后端（旧配置入口，等价于 acp.backends id=cursor） |
| `acp.enabled` | true | ACP 网关总开关 |
| `acp.backends[]` | 见下 | `{id, enabled, command, args, cwd}`，最多 12 条 |

### ACP 后端默认解析（dist/config.js resolveConfig 静态核对）

| id | 默认 enabled | 默认 command | 默认 args |
| --- | --- | --- | --- |
| codex | true（走独立 App Server 域） | `codex` | `app-server` |
| cursor | false | `agent` | `acp` |
| antigravity | acp 显式配置时 | `agy` | `--input-format stream-json --output-format stream-json` |
| pi | true | `pi-acp` | `[]` |
| claude | true | `claude-agent-acp` | `[]` |
| opencode | true | `opencode` | `acp` |
| hermes | false | `hermes` | `acp` |

注意：`acp.backends[].id` 虽允许自定义字符串（schema 校验
`^[a-z0-9][a-z0-9._-]{0,31}$`），但 gateway 的 `enabledBackends()` 白名单只放行
`['antigravity','cursor','pi','claude','opencode','hermes']`——**自定义 id（如
`devin`）会被静默过滤，不产生适配**。见 ACP_COMPATIBILITY.md。

## 本机模型/凭据现状（事实记录）

- `claude` CLI v2.1.309：配置于 `~/.claude/settings.json`，走第三方网关
  `ANTHROPIC_BASE_URL=https://www.shenlanqaq.com`，`ANTHROPIC_MODEL=claude-fable-5-2`。
  **未修改**。实测 `claude -p` 无响应（详见 TEST_RESULTS）。
- Devin CLI：`devin 3000.12.59`（`/Applications/Devin.app/…/bin/devin`；
  `~/.local/bin/devin` 为失效软链，未修复以免动用户环境）。
- `codex`：POC 内新装 0.169.0，未登录。
