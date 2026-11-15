# 测试执行记录

证据分级：`ACTUAL_RUN` 本机真实执行；`STATIC` 静态检查；`NOT_RUN` 未执行。

## V0.1.1 更新（增量）

### 探针安全整改（ACTUAL_RUN）

- `session/request_permission` **默认拒绝**（有 `reject_*` 选 `reject_once`，否则
  `cancelled`）；`--auto-approve` 仅当 cwd 位于 `--allow-root`（默认
  `~/agent-hub-poc`）内才生效，越界仍拒绝并记录 `autoApproveBlocked`。
- `session/cancel` 改为**通知**（无 id，符合 ACP 规范）。
- FAIL 退出码 = 1，PASS = 0，用法错误 = 2。
- 回归测试：`node --test scripts/acp-probe.test.mjs` => **10/10 PASS**
  （含 fake-acp-agent 夹具：权限拒绝、e2e 通知形态、crash→exit 1）。

### 进程管理（ACTUAL_RUN）

- `start-host.sh`/`stop-host.sh` 改为 PID 文件 + `lsof -d cwd` 归属校验，
  只管理 POC 进程；实测 stop→start 回路、异常 pidfile 清理、拒绝杀非 POC 进程。
  回滚文档同步更新，不再使用 `pkill`。

### Provider 本地化（ACTUAL_RUN，用户指示改用本地凭据）

发现本机可用凭据并实测：

| Provider | 端点 | 实测 |
| --- | --- | --- |
| shenlan 网关（OpenAI 兼容） | `https://www.shenlanqaq.com/v1` | `/v1/models` 列出 `gpt-6.1-sol` 等；`chat/completions` 200 返回 "OK" |
| shenlan 网关（Anthropic） | `…/v1/messages` | **全模型 403** `No permission to access group claude-pro`——token 无该组权限 → Claude 通道根因 |
| z.ai Anthropic 兼容 | `api.z.ai/api/anthropic` | 429 余额为零（key 有效，无配额） |
| DeepSeek account | `api.deepseek.com` | 用户在 Web UI 登录后拉到 2 模型；headless profile 另需独立登录，按用户指示弃用 |

### 真实 E2E（统一任务：修 buggy-cli `top_word` + 跑 unittest）

| Agent | 通道 | 结果 | 证据 |
| --- | --- | --- | --- |
| Codex | `codex exec`（CODEX_HOME 隔离 + shenlan provider） | **PASS** | apply_patch 修复 → `Ran 4 tests OK`（5,411 tokens），独立复验一致 |
| Devin | `devin acp`（用户浏览器 PKCE 授权后） | **PASS** | initialize/authenticate/sessionNew/sessionPrompt 全通，`text` 含修复说明；`git diff` 真实、测试 OK |
| DSH 原生 | `dsh headless`（pi-ai → shenlan `gpt-6.1-sol`） | **PASS** | final 事件 completed，diff 真实，测试 OK |
| Claude | `claude-agent-acp` | **FAIL**（非适配层问题） | initialize/sessionNew 通过；prompt 超时——根因为 gateway claude-pro 组 403，全模型同拒 |

### Remote 后端状态（ACTUAL_RUN）

- `Codex Remote domain ready`（CODEX_HOME + SHENLAN_API_KEY 注入启动环境后）
- `Cursor ACP ready` = claude-agent-acp spawn 握手通过（prompt 受 Provider 阻塞）
- `ACCOUNT_AUTH_REQUIRED 401` 仍在：**Remote 插件账号登录未做**
  （用户完成的是 DSH 的 DeepSeek 账号登录，两者不同）

## V0.1 基线结果（保留）

- DSH 0.2.2-rc.1 安装、`dsh web` 127.0.0.1:3080 token 鉴权、Remote 0.6.5 加载、
  host fingerprint `47C2 3346 AA7C`、托管服务连通、无公网端口——均 PASS。
- npm audit 209（8 moderate/201 high）已记录。

## 仍未验证

- R01–R12 全部依赖 Remote 账号 + 手机真机 → BLOCKED。
- 两个 Agent 会话并行/隔离（R06）：设计上每后端独立进程+按连接隔离（STATIC），
  需 Remote 账号后实测。
