# 测试执行记录

证据分级：`ACTUAL_RUN` 本机真实执行；`STATIC` 静态检查；`NOT_RUN` 未执行。

## 1. 安装与启动

| 项 | 结果 | 证据 |
| --- | --- | --- |
| DSH 安装 | PASS | `dsh --version` => `0.2.2-rc.1`（ACTUAL_RUN） |
| `dsh web` 启动 | PASS | 日志 `dsh web: http://127.0.0.1:3080/?token=…`；`lsof` 仅 127.0.0.1:3080 LISTEN（ACTUAL_RUN） |
| Web UI 鉴权 | PASS | 无 token `curl` => 401；带 token => 303（ACTUAL_RUN） |
| Remote 插件加载 | PASS | host.log：host identity ready / fingerprint `47C2 3346 AA7C` / server `https://dsh.r2049.cn`（ACTUAL_RUN） |
| 托管服务可达 | PASS | `curl https://dsh.r2049.cn/` => 200；插件 control 连接到达应用层被 401（网络路径通，仅差账号）（ACTUAL_RUN） |
| Host 无公网端口 | PASS | `lsof -iTCP -sTCP:LISTEN` 全部 127.0.0.1（ACTUAL_RUN） |

## 2. 统一代码任务夹具

`~/agent-hub-poc/workspaces/buggy-cli/`：独立 git 仓库（单独 commit），Python 文本
统计 CLI + unittest。故意缺陷：`top_word()` 用 `min` 返回最少频词。

基线 `[RUN]`：`PYTHONPATH=src python3 -m unittest discover -s tests -v`
=> `Ran 4 tests / FAILED (failures=1)`（test_top_word 期望 `b` 实得 `a`）。

各 Agent 用相同初始 commit 与验收条件、不同 git worktree 的统一任务执行：

| Agent | worktree | 执行结果 |
| --- | --- | --- |
| Claude Code (经 Remote/ACP) | — | NOT_RUN：Provider 网关对 SDK 调用无响应（见 §3）；待用户提供可用 Anthropic 授权后重跑 |
| Codex | — | NOT_RUN：`Not logged in` |
| DSH 原生 | — | NOT_RUN：无 DeepSeek 凭据 |
| Devin CLI | — | NOT_RUN：ACP 会话需 api_key/PKCE；且非 Remote 后端，仅独立探测可行 |

（未伪造任何成功；四个执行通道均在授权边界停止。）

## 3. ACP 协议探针执行（ACTUAL_RUN）

探针：`scripts/acp-probe.mjs`（JSON-RPC 2.0 over stdio/NDJSON：
initialize → authenticate? → session/new → session/prompt → session/cancel）。

### devin acp

```
initialize: PASS  {agentInfo:{name:"affogato",title:"Devin Agent"},protocolVersion:1,
                   authMethods:[devin-browser]}
session/new: FAIL -32000 "ACP host has not authenticated … meta.api_key … PKCE …
              Local CLI credentials are intentionally not used in ACP mode"
```
原始输出：evidence/devin-acp-probe.json（本仓 evidence/ 仅存脱敏结论）。

### claude-agent-acp

```
initialize: PASS  {agentInfo:{name:"@zed-industries/claude-agent-acp",version:"0.23.1"},
                   protocolVersion:1, authMethods:[]}
session/new: PASS (sessionId 返回, models present)
session/update: available_commands_update 已下发
session/prompt: FAIL 120s 无 agent_message_chunk（Provider 网关静默）
```

对照实验：`claude -p "Reply with exactly: ACP_OK"` 直接执行同样无输出（仅模型名
告警 `claude-fable-5-2`），证明是 Provider 故障。

### 插件内 Claude 握手（ACTUAL_RUN）

`ps aux` 证实插件 spawn `…/claude-agent-acp`；host.log "Cursor ACP ready"
（复用 cursor-process 适配器日志名）在 initialize+authenticate 流程后才打印。

## 4. 跨设备远程用例 R01–R12

全部 `BLOCKED`（Remote 账号未授权 + 手机需真人操作）。R01/R02 的本地前置条件已就绪
（Host 在线等待授权、Web 端 `https://dsh.r2049.cn` 在线）。逐项状态见
TEST_MATRIX.csv，人工步骤见 ANDROID_UAT.md。

## 5. 稳定性与安全（部分 ACTUAL_RUN）

- 断线语义：插件 `reconnect` 默认 4s→30s 退避（STATIC config.d.ts）；Host 侧任务在
  客户端断开后继续执行属设计语义（Pi/ACP 文档：client 断线只释放订阅），未实测。
- 权限边界：Remote 文件预览只读、目录枚举有界、工具 RPC 不暴露桌面控制（README
  安全节，STATIC 复核一致）。
- 远程终端：已在 POC 配置显式关闭（README 注明其以 Host 用户运行、不经 Agent 审批）。
- npm audit：209（8 moderate/201 high），详见 SECURITY_REVIEW.md。
- 凭据目录：`$DSH_HOME/ds-harness-remote/servers/` 已建立；迁移逻辑带
  credential-refresh-gate（静态）。
- 资源占用：单 Host + 1 个 claude-agent-acp 子进程常驻，RSS 观察 <100MB 级
  （粗略 `ps` 观察，非压测）。
