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

**测试：8/8 pass**（`node --test tests/distribution/install-e2e.test.mjs`）。

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
