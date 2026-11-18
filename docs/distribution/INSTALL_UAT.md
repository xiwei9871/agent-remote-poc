# Install UAT — Agent Learning Distribution V1

## 实测范围（ACTUAL_RUN）

隔离 `HOME` + `AGENT_LEARNING_HOME` + PATH-stub 的 `agentmemory`/`npm`，
完整走了一遍同事会经历的生命周期（`tests/distribution/install-e2e.test.mjs`）：

| 步骤 | 结果 |
| --- | --- |
| 首次安装（含 npm/daemon/connect 调用链 stub） | PASS — bundle、4 hooks、7 skills、receipt 全部落位；`connect devin --force`、`status` 被正确调用 |
| 二次安装 | PASS — `already up to date`，零变更 |
| 旧 worktree/checkout 残留路径 | PASS — 自动重定向到 shim（PR#7 P0 回归模式） |
| 外来 hooks（agentmemory/其他） | PASS — 全程 byte-identical |
| doctor 健康安装 | PASS/PARTIAL — 无 FAIL |
| doctor + 人为损坏 bundle | PASS — hash mismatch 检出 FAIL |
| rollback.sh | PASS — 恢复到最近一次安装前备份（逐字节一致） |
| uninstall.sh | PASS — 本包 hooks/skills/目录移除；`~/.agentmemory` 数据默认保留 |
| `--dry-run` | PASS — 零文件写入 |

**测试：12/12 pass**（`node --test tests/distribution/install-e2e.test.mjs`）。

## P0 整改复核（PR #10 复审后）

| 整改 | 实测 |
| --- | --- |
| P0-A skills 所有权 | 外来同名 skill → 备份 `.pre-agent-learning-*` 后安装本包版；卸载仅删带 `.agent-learning-owned` 且 hash 未变的，用户改过的挪为 `.removed-*`；无标记目录绝不动 |
| P0-B 差异回滚 | install 记录 ops 到 `config-changes.json`（跨次累积）；rollback 只撤销记录的变更，repoint 仅当原脚本仍存在才还原（死路径删条目），安装后新增 hooks/MCP 全部保留 |
| P0-C 数据保护 | `--purge-data` 需交互输入 `DELETE-DATA` 或 `CONFIRM_PURGE=DELETE-DATA`；默认保留 `~/.agentmemory` |
| P0-D 真实依赖 | **真实 `agentmemory@0.9.32` 二进制**在隔离 HOME 实跑 `connect devin --with-hooks`：写入 `mcpServers.agentmemory` + 6 hooks（SessionStart/UserPromptSubmit/PreToolUse/PostToolUse/Stop/SessionEnd）。另发现裸 `connect` 不写 hooks → install 已用 `--with-hooks` 修正 |
| P0-E doctor | 移除 rg 依赖（纯 POSIX+node）；bundle/hash/接线/E03/MCP/daemon 等核心故障一律 FAIL，仅健康提示/WARN/空库/技能数为 PART |
| P0-F 终包验证 | e2e 从 `release/dist/*.tar.gz` 解压执行 install→doctor→uninstall 全通过 |
| Issue #8 口径 | WARN 归因改为**来源未确定**（本包 10 钩 exit-0 有直接证据；不声称一定是 Devin 内部） |

## 交付物

- 源码包：`release/agent-learning-macos/`（install/doctor/rollback/uninstall + hooks bundle + skills + docs）
- 可传输归档：`release/dist/agent-learning-macos-1.0.0.tar.gz`（28KB）
  - SHA256：`e9731c11fce33064ba9f8ee0014eaa80b85b1cde6c3b1e9b3790bf2329174a87`
  - 校验文件：`agent-learning-macos-1.0.0.tar.gz.sha256`

## 同事真正要跑的唯一命令序列

```bash
tar -xzf agent-learning-macos-1.0.0.tar.gz
cd agent-learning-macos
./install.sh --yes && ./doctor.sh
```

## 未达标项（如实标注，决定 DISTRIBUTION_CANDIDATE 而非 COLLEAGUE_READY）

| 项 | 状态 | 说明 |
| --- | --- | --- |
| 非 Owner 真机/真 macOS 账户实测 | `CLEAN_MACHINE_NOT_VERIFIED` | 隔离 HOME 已证，真机未做 —— Gate 2 硬条件 |
| 同事真机 2 个新 Desktop 会话 | `NOT_TESTED` | 开发机已证（hypnotic-chef/quill-coelurus），同事机未验 |
| `hook None/exit1` 上游 WARN | `UNATTRIBUTED_DEVIN_INTERNAL` | 与本包无关有实证；doctor 会如实披露不隐瞒 |
| 自动纠错→自发持久化 | `NOT_VERIFIED` | 实验功能，Stable 不含 |
| Intel / Codex / Claude / Devin Cloud | `NOT_TESTED/UNSUPPORTED` | 不承诺 |

## 第二轮 P0 整改（复审 R2）

| 整改 | 实测 |
| --- | --- |
| Skills 所有权完整化 | 重装遇用户修改 → 挪为 `.user-modified-*` 不覆盖；卸载仅删 SKILL.md+标记（其他文件保留），空目录才移除；外来 skill 的 `.pre-agent-learning-*` 备份在卸载时**恢复原位** |
| 回滚身份唯一性 | repoint ops 按序逐 hook 配对（`consumed` per-hook），两个旧路径映射同一 shim 后**分别恢复各自原命令**；add ops 用条目快照深比较，不误删用户后加的同名条目 |
| AgentMemory 回滚 | connect 前快照 + `connect-changes.json` 记录新增钩/mcpServers；无 agentmemory 的机器回滚后 6 钩与 MCP 全部移除 |
| Doctor 严格化 | 6 条 agentmemory 钩**逐事件**核对（缺一即 FAIL）；e2e 断言该 PASS 行 |
| 测试规模 | 16/16（新增 4 个 R2 反例：双旧钩分别恢复、其他文件保留+外来恢复、重装不覆盖修改、无 AM 机器全量回滚） |

## 第四轮整改 + 真实依赖 UAT（复审 R4，ACTUAL_RUN）

### 新修复

| 项 | 实测证据 |
| --- | --- |
| 无 config 失败恢复 | `HOME` 全新（无 `.config`）+ connect 失败 → 安装器删除 connect 写的半成品 config，目录亦清空，exit 1（e2e `P0-R4` 测试） |
| **真实发现：connect 检测机制** | 真实 `agentmemory@0.9.32 connect devin --with-hooks --force` 在无 `~/.config/devin` 时报 `devin (skipped: not-detected)` **完全不接线**。install.sh 已改为 connect 前先建目录——全新账户真实 connect 实测写入 6 钩 + `mcpServers`（下方证据） |
| doctor 引号路径 | 真实 connect 写 `node "/path/…"` 带引号命令，悬空检查改为剥引号后验证存在性，实测通过 |

### 真实依赖 UAT（隔离 HOME + 真实 agentmemory 0.9.32 二进制，非 stub）

| 步骤 | 结果 |
| --- | --- |
| install.sh --yes | 真实 connect 写入 6 钩（真实 plugin 路径）+ mcpServers；4 条 learning 钩带 `AL-HOOK` 标签 |
| doctor.sh | 12 PASS + 1 FAIL(daemon) + 1 PART(空库) — daemon FAIL 为共享机假象：3111 被 owner 账户 daemon 占用、隔离 HOME 无凭据；真同事机上 install 自行拉起 daemon |
| rollback.sh | `undid 11 package change(s)`（4 learning + 6 AM 钩 + 1 mcp）→ hooks 0、mcp 无 |
| reinstall + uninstall.sh | 7 connect additions + 4 learning + 7 skills + guard dir 全清；mcp 无；记忆保留 |

### 仍缺（COLLEAGUE_READY 门槛）

- 独立 macOS **真账户**：Devin Desktop 装好的同事/测试账户首装（需 owner 建账户，GUI/凭据非我可达）
- 该账户内 2 个全新 Desktop 会话目视：`Hook failed` 消失 + SessionStart 召回 + E03 阻断
- daemon 自启在干净账户上的验证（共享机无法复现）

## 第三轮 P0 整改（复审 R3）

| 整改 | 实测 |
| --- | --- |
| Hook 唯一身份 | 每条写入命令带 ` # AL-HOOK:<8hex>` 后缀（sh -c 是注释、exec-array 是 node 忽略的多余 argv——shim 只读 argv[2]，已实测 E03 带后缀仍 block）。回滚按 op.to 精确匹配**全局唯一**的那条钩——重排、复制、同 shim 映射都无法串位。R3 反例测试：A/B 条目装后被同事对调，回滚后 B@entry0→wt-B、A@entry1→wt-A 各回原位 |
| 安装失败事务 | 安装前快照 `config.json.pre-agentlearning-*`；`set -E` + `run()` 失败即 die + ERR trap 双保险——connect 中途失败实测：stderr 报 restore、config 逐字节还原、exit 1（修复了 bash ERR trap 不捕函数返回值的真实缺陷） |
| 卸载完整性 | uninstall 现同时按 connect-changes.json 移除 connect 新增的 6 钩 + mcpServers（仅限本机原无 agentmemory 情形，已装者不受影响）；外来 skill 备份恢复原位 |
| Doctor 严格化 | 新增 3c 悬空检查：所有 `node <path>` 钩命令的脚本路径必须存在，死路径直接 FAIL（正是本包要消灭的 MODULE_NOT_FOUND 类故障）；6 条 agentmemory 钩逐事件核对保留 |
| 测试规模 | 20/20（R3 新增 4 反例：重排还原、connect 失败事务、卸载含 connect 撤销、悬空 FAIL） |
