# ACP / 后端接入兼容性分析

证据分级：`[RUN]` 实际运行验证；`[STATIC]` 源码静态检查；`[DOC]` 官方文档。

## 结论摘要

| 后端 | 接入方式 | 协议握手 | 会话能力 | 状态 |
| --- | --- | --- | --- | --- |
| Claude Code | `claude-agent-acp`（zed 官方 0.23.1） | `[RUN]` initialize+session/new PASS（插件内与独立探针双重验证） | prompt 被 Provider 网关阻塞 | **适配层 PASS / 端到端 BLOCKED_PROVIDER** |
| Codex | `codex app-server` | `[RUN]` 插件域初始化成功 | 需 Codex 登录 | **BLOCKED_AUTH** |
| DSH 原生 | DSH Agent Loop | — | 需 DeepSeek API key/OAuth | **BLOCKED_AUTH** |
| Devin CLI | `devin acp`（devin 3000.12.59） | `[RUN]` initialize PASS | session/new 要求 authenticate | **协议兼容 PASS / 会话 BLOCKED_AUTH / 无上游适配器** |

## 1. Claude Code（会话 A）

- Host 接入：`claude-agent-acp` stdio（Remote docs/acp-remote.md 列出：工作区/历史、
  文字、流式工具、中断、单次审批、模型/effort）。
- `[RUN]` 插件日志 "Cursor ACP ready" 实际为 claude 后端：复用 cursor-process 适配器
  类打印；`ps aux` 证实子进程是 `…/tools/node_modules/.bin/claude-agent-acp`，
  ready 仅在 ACP `initialize`（+可选 `authenticate`）完成后打印 → 插件内握手实测通过。
- `[RUN]` 独立探针（scripts/acp-probe.mjs）：
  - `initialize` => agentInfo `Claude Agent 0.23.1`，protocolVersion 1，`authMethods: []`
    （复用本机 claude 凭据，无需 ACP 层认证）
  - `session/new` => 成功（sessionId 返回，models catalog present）
  - `session/update` => `available_commands_update`（会话真实建立）
  - `session/prompt` => **120s 超时**：`claude -p` 直连亦无输出——本机 claude 走第三方
    网关 `shenlanqaq.com` + 自定义模型 `claude-fable-5-2`，对 SDK 形态调用静默无返回。
    判定为 Provider 侧故障而非适配层故障。
  - `session/cancel` => `-32601`：注意 ACP 规范中 cancel 是**通知**而非请求
    （探针按请求发送，适配器按"未知方法"拒绝——探针行为，非缺陷）。
- 与"DSH 使用 Claude API"的区分：本路径运行的是**真实 Claude Code Agent**
  （claude-agent-sdk 进程、自带工具与审批流），不是把模型 API 挂进 DSH 会话。

## 2. Codex（会话 B）

- Host 接入：`codex app-server` stdio（独立 App Server 域，不走 ACP gateway）。
- `[RUN]` 插件日志 `Codex App Server ready` + `Codex Remote domain unavailable
  CODEX_AUTH_REQUIRED`：域已初始化，鉴权缺失。
- `[RUN]` `codex login status` => `Not logged in`。需用户 `codex login`（ChatGPT）或
  API key → `BLOCKED_AUTH`。
- 注意 Codex Project 仅注册 Host 已存在目录，不创建目录/不写 Harness 存储（文档）。

## 3. DSH 原生（会话 C）

- `[STATIC]` Provider 包仅 `dsh-llm-deepseek`（account OAuth / api-key /
  `DEEPSEEK_API_KEY`）与 `dsh-llm-pi-ai`；无通用 OpenAI 兼容端点。
- 需用户提供 DeepSeek API key 或账号登录 → `BLOCKED_AUTH`。

## 4. Devin CLI（会话 D，实验性）

### 4.1 上游适配器确认：`不存在` `[STATIC]`

- Remote `acp.backends[].id` schema 允许任意 id，但
  `dist/acp/gateway.js:116` 与 `:892` 的 `enabledBackends()`/重配过滤白名单为
  `['antigravity','cursor','pi','claude','opencode','hermes']`——自定义 `devin`
  条目被**静默丢弃**，不会 spawn。
- Codex 走独立 App Server 域，ACP 域无 Devin 适配代码。
- 结论：通过 Remote 平台统一接入 Devin **本轮不可行**（除非自行实现上游 adapter；
  按任务约束未修改上游）。

### 4.2 `devin acp` 独立协议探测 `[RUN]`

```
initialize  => PASS  agentInfo={"name":"affogato","title":"Devin Agent","version":"0.0.0-dev"}
                     protocolVersion=1
                     authMethods=[{id:"devin-browser",name:"Log in with browser"}]
authenticate => 超时（需浏览器 PKCE 或 API key，非 CLI 可代办）
session/new => 服务端明确拒绝：
  code -32000: "ACP host has not authenticated. Call the `authenticate` ACP method
  with `meta.api_key` set to the user's API key (or invoke the browser auth method
  to start the PKCE browser flow) before opening a session. Local CLI credentials
  are intentionally not used in ACP mode to avoid attributing usage to the wrong
  account."
```

- `devin acp --help` 佐证选项：`--agent-type {summarizer|review|codemap}`、`--model`、
  `--refusal-fallback`、`--cloud`（代理至 Devin Cloud ACP WebSocket）。
- 评估：协议层与 Remote ACP gateway 契约一致（标准 initialize/session/* over stdio）；
  若未来上游新增 backend adapter 或用户接受 `meta.api_key` 注入的自定义包装，
  接入路径清晰。当前判定 `BLOCKED_AUTH` + `无上游适配器`。

## 5. 后端隔离性 `[STATIC]+[RUN]`

- 每个 ACP 后端独立 stdio 子进程；`enabledBackends()` 独立启停，配置热生效只重启变化
  的后端（docs + 代码 `pendingReconfiguration` 逻辑）。
- 未就绪后端**不会**被静默替换成其他后端（文档与日志一致：缺二进制明确报
  `*_BINARY_UNAVAILABLE` / `spawn … ENOENT`，域整体报 `ACP Remote domain
  unavailable` 而非伪装成功）。
- RPC/stream 按连接隔离；多客户端同连一个 Host 无并发上限（README）。
