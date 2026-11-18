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
