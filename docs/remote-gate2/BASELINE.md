# Gate 2 基线（2026-11-16 只读预检）

## 组件版本

| 组件 | 版本/来源 | 状态 |
| --- | --- | --- |
| DSH | `0.2.2-rc.1`（`~/agent-hub-poc/runtime/node_modules/.bin/dsh`） | 运行中 |
| ds-harness-remote | `0.6.5`（profile 插件，与 latest 一致 `checkedAt`） | 运行中 |
| DSH_HOME | `~/agent-hub-poc/dsh-home` | POC 隔离目录 |
| Remote Server | `https://dsh.r2049.cn`（`dotnet-experimental`） | 可达 443 |
| dsh-Go | Owner 手机已装（版本待 Owner 报） | remote-only 路径受 DeepSeek 登录约束 |

## Host 身份

- deviceId `01a1dc9b-7507-78b3-8ae7-a1c5b0d73932`
- fingerprint `47C2 3346 AA7C`（与上轮一致，未漂移）
- 监听：仅 `127.0.0.1:3080`（`dsh web --no-open`，单实例，PID 属主已核）
- 安全面：remote terminal `enabled:false`（cordis.patch.yml）；Host shell/写文件未开放

## 进程管理记录

- 原 `dsh web` PID 7569 → 正规 SIGTERM 停止（属主核验 `host.pid`+cmdline 后）；
- 重启 PID 45342：目的为捕获一次性 launch token（内存随机值，无持久化，
  不重启拿不到本地控制面入口）；重启后 deviceId/指纹/授权均保持。
- 全程无 `pkill -f`、无按端口批量 kill。

## 既有会话

`dsh-home/sessions/`：
- `--Users-xiwei-Documents-deepseek-harness-default-workspace--`
- `--Users-xiwei-agent-hub-poc-workspaces-buggy-cli-dsh--`（上轮修 bug 会话）

Remote Web 侧可见 `default-workspace → 未命名会话`（Owner 截图证实）。

## 服务端能力（公开发现）

`GET /api/v1/auth/oauth/providers`：
`devicePairing=dsh-pairing-v1`、`devicePairingQr=fragment-ticket-v1`；
OAuth：知乎/GitHub/Google（含 qrStartUrl）。

## 模型与 Provider 配置（2026-11-16 ACTUAL_RUN）

| 后端 | 配置 | 状态 |
| --- | --- | --- |
| DSH 默认模型 | `shenlan/gpt-6.1-sol`（pi-ai → https://www.shenlanqaq.com/v1，openai-completions） | **已生效**：cordis.patch.yml 修正 name 定向覆盖（原 deepseek-flash 顶掉 shenlan），`--dump-config` 验证；进程 env 含 SHENLAN_API_KEY |
| Codex | `codex-home/config.toml`：model_provider=shenlan, model=gpt-6.1-sol, wire_api=responses | 已配好（沿用上轮）；Remote domain ready |
| Claude ACP | `claude-agent-acp@0.23.1` 已接入 backends | **BLOCKED_PROVIDER**：shenlan Anthropic 路由 claude-pro 组 403；z.ai 429 余额不足。网关侧开通前不可用 |

- Host 重启验证：SIGTERM→带 env 重启（PID 79245），server control connection
  于 04:21:55 自动恢复 online——**授权随重启持久**（server-credentials.json 生效）。
- 未做真实任务验证（W02 会话内执行待 Web/手机触发）。
