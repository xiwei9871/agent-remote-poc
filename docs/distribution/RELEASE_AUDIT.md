# Release Audit — Agent Learning Distribution V1 (Gate 0)

日期：2026-11-18 · 分支：`feature/agent-learning-colleague-installer-v1`
状态标记：`ACTUAL_RUN`（实测）/ `STATIC`（静态核对）/ `OWNER_VERIFIED` / `NOT_TESTED` / `BLOCKED`

## 1. 权威基线复核（Issue #9 要求先行只读核对）

| 项 | 实测值 | 证据级别 |
| --- | --- | --- |
| Node | v24.14.1（`~/.local/node/bin/node` + homebrew 双源） | ACTUAL_RUN |
| npm | 11.11.0 | ACTUAL_RUN |
| macOS | 26.7.2 arm64（Apple Silicon；Intel 未测 → `NOT_TESTED`） | ACTUAL_RUN |
| agentmemory | **0.9.32** npm 全局；`agentmemory connect devin` 为官方接线命令 | ACTUAL_RUN |
| daemon | `iii compose` 自管 worker，REST `localhost:3111`，viewer `:3113`，无 launchd；`agentmemory`（无参）启动 | ACTUAL_RUN |
| Devin 用户配置 | `~/.config/devin/config.json`（hooks）+ `~/.config/devin/mcp_config.json`（MCP） | ACTUAL_RUN |
| 已装 hooks | `loaded=10`：6×agentmemory + 4×learning（全部指向稳定 shim） | ACTUAL_RUN（host log `hooks discovery`） |
| Guard 稳定目录 | `~/.agent-learning/guard/`（shim+bin bundle+manifest+repo-root 指针） | ACTUAL_RUN |
| Skills 全局路径 | `~/.config/devin/skills/<name>/SKILL.md`（官方文档确认，`~/.agents/skills/` 也可用） | STATIC（官方 docs） |
| Hook 协议 | stdin JSON → stdout verdict；`decision:block` 已实测 | ACTUAL_RUN |
| 冻结基线 | PR#3 `15b0422`（只读不动）；PR#7 `e8bba78` 已部署到 Owner Mac | STATIC |

## 2. Issue #8 只读归因核对（`hook None / exit 1` WARN）

**新增实测证据（2026-11-18，本会话内）**：

- WARN 自 458 → **1450+**，部署后仍在持续增长 —— 不是纯旧会话缓存。
- 时间序列实测：WARN 出现在 `create_session` **之前** ~30ms、`Permission decision` 之前 —— 即每次 exec 的 **PreToolUse 求值时刻**，约 1 条/exec。
- 全部 10 个已注册 hook 用真实形态合成事件逐一执行：**exit 0**（agentmemory 全部 `catch→exit(0)`，结构上不可能 exit 1；shim 从不非零退出）。
- `hooks discovery: loaded=10 (global=10, project=0)`，plugin `hooks=0` —— superpowers 插件 hook **未注册**（`${CLAUDE_PLUGIN_ROOT}` 格式不被 Devin 加载，但加载器本身不报 WARN）。
- `~/stock_research/.codex/hooks.json` 存在但 **Devin providers 列表无 codex**，根本不加载。
- `health.json` 今天 05:33 仍 `status:ok`（guard 在 WARN 同期正常工作）；agentmemory 观测数 1373→1419 持续捕获 —— 其 hooks 在真实事件下正常运行。

**归因结论（Gate 0 判定）**：WARN 源 `hook None` **不是** 10 个已注册 hook 之一（全部实测 exit 0 且真实运行证据齐全）。最可能是 Devin 内部 "effects evaluator"（位于 permission/auto-decide 链路，`by cog` 决策紧邻触发点）或未命名评估命令 —— **归因为 `UNATTRIBUTED_DEVIN_INTERNAL` 候选，非本包 hook**。Issue #8 保持 OPEN。

**对同事分发的阻断评估**：
- 本包交付的 hook 组件均有独立可证健康证据（真实 E03 拦截、health.json、exit-0 契约）→ **不构成 P0 阻断**。
- 但同事机器上同样可能出现该 WARN → `doctor.sh` 必须含 **post-install WARN 扫描**，输出 `KNOWN_ISSUE(UNATTRIBUTED)` 而非假装 ALL_HOOKS_HEALTHY；发行说明如实披露，不隐瞒。

## 3. 文档矛盾点清理（发行口径）

| 旧表述 | 发行口径 |
| --- | --- |
| hooks 指向 checkout 内 `scripts/learning/` | 一律指向 `~/.agent-learning/guard/hook-shim.mjs` 稳定路径 |
| `agentmemory connect` 需逐一手写 hooks | 优先用官方 `agentmemory connect devin`；本包只合并 learning 4 钩 |
| 自动纠错→自发 lesson_save | **EXPERIMENTAL**：未验证，不进 Stable 默认能力 |
| E05 远端 SHA | best-effort（cwd 缺失时形状级），不宣称完备核验 |

## 4. 支持矩阵（发行范围）

| 平台 | 状态 |
| --- | --- |
| macOS arm64 + Node ≥18 + Devin CLI/Desktop | **支持（本包验证目标）** |
| macOS Intel | `NOT_TESTED` |
| 非 macOS / Codex / Claude Code / Devin Cloud | `UNSUPPORTED`（不承诺） |
