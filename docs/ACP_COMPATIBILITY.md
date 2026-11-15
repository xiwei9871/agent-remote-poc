# ACP / 后端接入兼容性分析

证据分级：`[RUN]` 实际运行验证；`[STATIC]` 源码静态检查；`[DOC]` 官方文档。

## 结论摘要

| 后端 | 接入方式 | 协议握手 | 会话能力 | 状态 |
| --- | --- | --- | --- | --- |
| Claude Code | `claude-agent-acp`（zed 官方 0.23.1） | `[RUN]` initialize+session/new PASS（插件内与独立探针双重验证） | prompt 被 Provider 网关阻塞 | **适配层 PASS / 端到端 BLOCKED_PROVIDER** |
| Codex | `codex app-server` | `[RUN]` 插件域 ready | `[RUN]` codex exec 真实修 bug PASS | **PASS（Remote 域就绪，待账号）** |
| DSH 原生 | DSH Agent Loop | — | `[RUN]` headless 真实修 bug PASS | **PASS（pi-ai→shenlan）** |
| Devin CLI | `devin acp`（devin 3000.12.59） | `[RUN]` initialize+authenticate+session/prompt 全 PASS | `[RUN]` 真实修 bug PASS | **PASS（独立 ACP）/ 无上游适配器** |

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
- `[RUN]` `codex login status` => `Not logged in`（ChatGPT 登录仍缺）。改为利用
  **本机已有 Provider**：`CODEX_HOME` 指向 POC 隔离目录，`config.toml` 定义
  `model_providers.shenlan`（`base_url=https://www.shenlanqaq.com/v1`,
  `wire_api=responses`, `env_key=SHENLAN_API_KEY`）。
- `[RUN]` `codex exec`（隔离 CODEX_HOME + env key）完成真实任务：读
  `stats.py`→apply_patch 修 `top_word`→`Ran 4 tests OK`，5,411 tokens；
  独立复验通过。
- `[RUN]` 将 `CODEX_HOME`+`SHENLAN_API_KEY` 注入 Host 启动环境后插件日志
  `Codex Remote domain ready`——Remote 侧 Codex 后端就绪，仅差账号登录。
- 注意 Codex Project 仅注册 Host 已存在目录，不创建目录/不写 Harness 存储（文档）。

## 3. DSH 原生（会话 C）

- `[STATIC]` Provider 适配：`dsh-llm-deepseek`（account/api-key）与
  `dsh-llm-pi-ai`（通用多 provider：`providers` dict 为 volatile config，
  支持 `openai-completions`/`openai-responses`/`azure`/`openai-codex-responses`）。
- `[RUN]` 用户在 Web UI 完成 DeepSeek 账号登录（拉到 `deepseek-chat` 等 2 模型），
  但 headless profile 要求独立登录；按用户指示改用本机 shenlan 网关：
  `llm-pi-ai.providers.shenlan`（`api: openai-completions`,
  `baseURL: …/v1`, `apiKeyEnv: SHENLAN_API_KEY`）+ `agent-default-model`
  → `shenlan/gpt-6.1-sol`。
- `[RUN]` `dsh headless --permission-mode workspace-write` 完成真实任务：
  修 `top_word`→4 tests OK；独立复验通过。

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

**V0.1.1 更新**：用户在浏览器完成 `devin-browser` PKCE 授权后（本人操作），
重跑探针 `initialize/authenticate/sessionNew/sessionPrompt` 全部 PASS，
`text` 返回 "ACP_OK"。随后在隔离 worktree 用 `--auto-approve`（cwd 在
allow-root 内）完成真实修 bug 任务：diff + `Ran 4 tests OK`。→
**协议+会话+任务全 PASS（独立 ACP 通道）**；仍无上游 Remote 适配器。

## 5. 后端隔离性 `[STATIC]+[RUN]`

- 每个 ACP 后端独立 stdio 子进程；`enabledBackends()` 独立启停，配置热生效只重启变化
  的后端（docs + 代码 `pendingReconfiguration` 逻辑）。
- 未就绪后端**不会**被静默替换成其他后端（文档与日志一致：缺二进制明确报
  `*_BINARY_UNAVAILABLE` / `spawn … ENOENT`，域整体报 `ACP Remote domain
  unavailable` 而非伪装成功）。
- RPC/stream 按连接隔离；多客户端同连一个 Host 无并发上限（README）。
