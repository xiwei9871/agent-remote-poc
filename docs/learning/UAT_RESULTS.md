# 验收结果（Gate 0/1 当前进度）

## Gate 1 隔离环境实测（`~/agent-learn-iso`，HOME/XDG/AGENTMEMORY_DATA_DIR 全隔离）

| 项 | 结果 | 证据级别 |
| --- | --- | --- |
| agentmemory 0.9.32 npm 隔离安装 | PASS | ACTUAL_RUN（190 包，锁版本） |
| daemon 启动（iii-engine 0.25.0 pinned 自动安装） | PASS | ACTUAL_RUN：REST :3111 / Viewer :3113 / ws :49134 |
| API 鉴权 | PASS | 无 secret → `{"error":"unauthorized"}`；Bearer 后正常 |
| `connect devin --with-hooks`（隔离 XDG） | PASS | 合并式写入 config.json（既有 org_id/permissions 全保留），mcpServers+6 hooks，自动备份 |
| 检测机制 | 记录 | `connect` 要求 devin 配置目录存在；隔离下需先建 `$XDG/devin/` |
| **上下文注入开关** | **关键发现** | `AGENTMEMORY_INJECT_CONTEXT=true` 必须显式开启，否则 SessionStart 只注册不注入 |
| SessionStart 注入（proj-a 有 lesson） | PASS | 输出 Devin 格式 `hookSpecificOutput.additionalContext`，含 lesson 全文+confidence+会话历史 |
| 项目隔离（proj-b） | PASS | 无注入——proj-a lesson 未泄漏 |
| 项目分区方式 | PASS | `git rev-parse --git-common-dir` 解析 repo 根（worktree 归并，符合设计要求） |
| 会话注册+prompt 捕获 | PASS | `/agentmemory/sessions` 显示 6 个合成会话、observation 计数 |
| Lesson REST 创建 | PASS | `POST /lessons` → `lsn_*`，含 confidence/decayRate/source 字段 |
| UserPromptSubmit 注入 | 无此功能 | prompt-submit 是 telemetry-only hook（设计上不写 stdout）——**逐轮召回走 pre-tool-use 而非 prompt-submit** |
| **guard.mjs 门禁（本仓自研）** | PASS 11/11 | `node --test`：E01/E02/E03/E05 全部按策略 block/warn/放行；异常输入 fail-open |
| 真实 devin 会话触发 hook | NOT_TESTED | `devin auth status`=未登录，`devin -p` 拒绝 → **T01-T08 需 Owner `devin auth login`** |

## 真实会话验收（Gate 2，待授权）

- T01–T08：全部依赖 ①用户级 config 写入批准（GLOBAL_INSTALL A–D 项）
  ②`devin auth login`（交互式，用户操作）。
- Desktop 传播（T07）/Cloud（T08）：同上，Cloud 预期 UNSUPPORTED。

## 指标（隔离环境样本）

- SessionStart hook 端到端延迟：单次 fetch ~<1s（INJECT_TIMEOUT_MS=1500 上限，
  REGISTER=800）——满足 P95<2s 预算，真实会话复测。
- 注入体积：单 lesson+1 session 观察 ≈ 0.5KB ≪ 1500 tokens 预算。

## Gate 2 进度（真实环境，部分实测）

| 项 | 结果 | 证据 |
| --- | --- | --- |
| 全局安装（npm -g 0.9.32 + connect --with-hooks） | PASS | ACTUAL_RUN；npx-cache 路径已清理换全局路径；备份于 ~/.agentmemory/backups/ |
| 真实新会话加载 hooks | **PASS** | devin 日志 `hooks discovery: loaded=10 (global=10, by_provider=[devin=10])` |
| 真实会话 MCP 接入 | **PASS** | `MCP server 'agentmemory' connected successfully`（ACP session buttery-marigold） |
| lesson 注入→影响真实决策 | **PASS** | 会话思考文本显式引用 E03 lesson，放弃裸 pkill 改 pgrep 预查（session-B.jsonl） |
| Guard 硬阻断（模拟工具事件） | **PASS** | E01/E03/E05 全输出 `decision:block`，良性静默，audit.jsonl 落证；符合 Devin stdout 契约 |
| T05 撤销 | PASS | `POST /lessons/delete` 后 session-context.mjs 注入中该 lesson 消失 |
| T02 纠错→持久化（真实用户纠错） | NOT_TESTED | 需 `devin auth login` 后跑 devin -p 会话 |
| T03 新会话召回避免复发 | 部分 | lesson 影响决策已证（B会话）；标准双会话纠错-复现链路待 auth |
| T04 新项全局/隔离 | 部分 | 隔离环境 PASS；真实新项会话待 auth |
| Desktop 会话 | NOT_TESTED | 需用户在 Desktop 开新会话观察 |
| Cloud | UNSUPPORTED | 本地 daemon 云端不可达 |
| `devin -p` 会话 | BLOCKED_AUTH | `devin auth login` 待用户执行（ACP 每次 spawn 独立 PKCE，已停用该路径） |

## Guard 判定修正记录

- decision:block 以 stdout JSON 形式给出（与 exit 2 等效，Devin 文档双通道均认）。
- ACP `authenticate` 为按 spawn 独立 PKCE，不写 credentials.toml——因此停用 ACP
  驱动做验收，改用 `devin -p`（auth 后无弹窗）。ACP 凭据复用问题留作独立排查。
