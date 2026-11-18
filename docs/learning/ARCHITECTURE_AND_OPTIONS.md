# 架构与候选决策（Gate 0）

证据级别：`ACTUAL_RUN` 实测 / `STATIC` 代码或文档静态检查 / `DOC` 官方文档。

## 已核实的原生能力（Devin CLI 3000.12.59）

`ACTUAL_RUN`+`DOC`（docs/extensibility/hooks/*.mdx + `devin --help` 实测）：

- 8 个生命周期事件：`SessionStart` `UserPromptSubmit` `PreToolUse`
  `PostToolUse` `PermissionRequest` `Stop` `PostCompaction` `SessionEnd`。
- **用户级入口**：`~/.config/devin/config.json` 的 `"hooks"` 键（XDG
  `XDG_CONFIG_HOME/devin/config.json`），对本机全部项目的新 Session 生效——
  满足"一次安装、全局自动生效"的载体要求，无需项目内文件。
- Hook 契约：stdin JSON（`session_id`/`prompt_id`/`tool_name`/`tool_input`）；
  stdout `{"decision":"block"|"approve"}`、`hookSpecificOutput.additionalContext`、
  `updatedInput`；exit 2=阻断，其他非零=记错不阻断（fail-open）。
- `DEVIN_PROJECT_DIR` 由 Devin 自动注入 hook 进程。
- `/hooks` slash 命令可列出已加载 hook 及来源文件。
- `devin mcp` 管理 stdio MCP；当前机器 `mcp list` = 空。
- `devin rules`：已有 `CLAUDE`/`global_rules` 两条 always-on 规则在生效——
  静态全局规则可复用此通道，但不承担"按意图召回"职责。
- Cloud 差异：SessionStart 在 VM 后台跑、decision 被忽略（除 org blocking
  hook）；SessionEnd 不触发 → 云端单独判定，见 GUARD_POLICY/风险文档。

## 候选对比

| 候选 | 版本/许可 | 能力 | 判定 |
| --- | --- | --- | --- |
| rohitg00/agentmemory | npm `0.9.32`（0.9.33 发布 6 天，选 ≥7 天基线）；Apache-2.0；30.4k★；696 commits | 本地 daemon(:3111)+viewer(:3113)，`~/.agentmemory/` 数据；`connect devin` 写 MCP+6 hooks 到用户 config（自动备份）；Lesson/记忆/会话一等实体；54 MCP tools（core=8）；17 skills；默认零 LLM、BM25 召回、`EMBEDDING_PROVIDER=local` 可选；`AGENTMEMORY_PRE_COMPACT_BUDGET=1500`；密钥脱敏+capture allow/deny | **reuse（主记忆真源）** |
| AgentMemoryRepo/agentmemoryrepo | MIT；867★ | git 记忆 spec/Skill，无运行时/无 hook/无门禁 | reject 为主真源；留作 export 格式选项 |
| Devin 原生 rules/skills | 已启用 | always-on 上下文块；手动 skill | configure：静态全局规则索引用 rules，不用作主机制 |
| Devin Cloud Memory/Dreaming | — | 文档中本地 CLI 无此功能，Cloud 专属 | UNSUPPORTED（本期）；需 Cloud MCP+可达存储另行批准 |
| gov-rollout project-continuity | 本机 skill | "session start 手动调用"型，无 hook | 只读对照：证明"写了≠自动执行"，正是本任务要解决的缺口 |

## 架构决策（单一真源）

```
~/.config/devin/config.json
├─ mcpServers.agentmemory  → npx @agentmemory/mcp@0.9.32 → localhost:3111
└─ hooks (user-level, 全项目自动加载)
   ├─ agentmemory 6 hooks   → 捕获+注入（SessionStart/UPS/PreTU/PostTU/Stop/SessionEnd）
   └─ guard hooks (本仓)     → 确定性门禁：PreToolUse block、Stop/PostToolUse 校验
       scripts/learning/guard/*.mjs
~/.agentmemory/            → daemon 数据（KV store, .env, secret, vault, backups）
```

- 记忆/召回/Lesson 存储：**reuse** agentmemory，不自建第二存储（避免冲突注入）。
- 错误防复发门禁：**minimal extension**——agentmemory hook 无 block 语义，
  本仓提供独立 PreToolUse/Stop guard 脚本与 lesson→policy 的 ENFORCED 投影。
- Lesson 生命周期：agentmemory lesson 实体 + 本仓 status/conidence 字段约定
  （CANDIDATE→VALIDATED→ENFORCED，REJECTED/REVOKED），投影文件驱动 guard。
- Cloud：`UNSUPPORTED`（本地 daemon 不可达云端 VM；需部署+Secrets 另行批准）。
- Desktop：与 CLI 共享 `~/.config/devin/config.json` → 预期同 hook 生效，
  属 Gate 2 T07 实测项。

## 安装/隔离约束

- 锁定 npm `0.9.32`（非 `@latest`）；tarball 已在 `/tmp/am-audit` 审查：
  hook 为独立 Node 脚本、仅访问 `AGENTMEMORY_URL`（默认 localhost:3111，
  非 loopback 强制 HTTPS）、`DEVIN_PROJECT_DIR` 做项目分区。
- Gate 1 全程 `HOME`/`XDG_CONFIG_HOME` 隔离，不碰真实 `~/.config/devin`。
- 用户级写入（真实 config.json + daemon 常驻）为 Gate 2，需 Owner 逐项批准，
  清单见 GLOBAL_INSTALL.md。
