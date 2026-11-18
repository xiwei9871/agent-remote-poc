# STOP-HOOK-EXIT1 RCA — 全局 Guard Stop Hook 反复 exit 1（Issue #6）

状态：根因已实锤（实机证据 + 确定性重现）。修复分支 `fix/agent-learning-stop-exit1`。

## 结论（一句话）

用户级 hook 注册在 **git checkout 内部路径**；checkout 从
`research/agent-learning-global-v1` 切到 `research/dsh-remote-gate2-v02`
后 `scripts/learning/` 在该分支不存在 → `node <缺失脚本>` →
`MODULE_NOT_FOUND` → **exit 1** → Host 显示 `Hook failed`。

**不是** E05 裁决、不是策略误报、不是 Node/权限问题——脚本根本没有机会
运行（连 audit 都写不出）。同类失败实际波及**全部 4 个指向该路径的
hook**（SessionStart-context、PreToolUse、PostToolUse、Stop）；UI 只露出
Stop 一条。期间 E03 等 PreToolUse 硬阻断保护**处于静默失效状态**。

## 证据链（原件见 evidence/stop-exit1/）

1. `~/.config/devin/config.json`：4 个 hook 均注册
   `node /Users/xiwei/agent-remote-poc/scripts/learning/guard/guard.mjs`
   （及 session-context.mjs）——仓库内路径。
2. `.git` reflog：`HEAD@{2} checkout: moving from
   research/agent-learning-global-v1 to research/dsh-remote-gate2-v02`；
   `git ls-tree` 证实 `scripts/learning/` 仅存在于 learning 分支。
3. `~/.agent-learning/guard/audit.jsonl` 最后成功写入
   `2026-11-16T04:09:13Z`（E04）；此后**无任何新条目**——脚本进程根本没
   启动，与"裁决规则触发"矛盾。
4. Devin 实机日志 `devin_20261116-111927_68806.log`（本会话，GPR 工作
   目录）：自 `04:10:57Z` 起持续 `Effects evaluator failed for hook ...
   Command exited with code 1`——与 audit 断流时间窗吻合。
5. 确定性重现（exit 1）：

   ```
   $ node /Users/xiwei/agent-remote-poc/scripts/learning/guard/guard.mjs
   Error: Cannot find module ... code: 'MODULE_NOT_FOUND'  → exit 1
   ```

6. 排除项：冻结 SHA `15b04227` 的 guard.mjs 无 `exit(1)` 分支；
   `main().catch → exit 0` 对全部脚本内错误 fail-open——所以脚本内 bug
   不可能产生 exit 1，只剩"进程未起来"一类原因。

## 修复（本分支）

| 件 | 作用 |
|---|---|
| `scripts/learning/guard/hook-shim.mjs` | 稳定路径入口：装到仓库外 `~/.agent-learning/guard/`，按 `$AGENT_GUARD_HOME` → `repo-root` 指针 → `bin/<basename>` 解析真实脚本；缺失/子进程崩溃/坏 argv 一律 **audit + exit 0**，stdout 原样转发（block 裁决无损透传） |
| `guard.mjs` 加固 | `emit` EPIPE 防护；`readSignals` 读取竞态防护；内部错误审计加 `kind:"internal-error"` 分类 |
| `install-shim.sh` | 装 shim+写 repo-root 指针，打印 config diff；`--apply` 才改 config（自动备份） |
| 测试 | `hook-shim.test.mjs` 6 项 + `guard.test.mjs` 17 项（新增缺失/损坏 policy 用例）全过 |

## 所需 Owner 操作（未授权不执行）

`install-shim.sh --apply` 会把 4 个 hook command 改指稳定 shim：

```
node /Users/xiwei/agent-remote-poc/scripts/learning/guard/guard.mjs
  → node /Users/xiwei/.agent-learning/guard/hook-shim.mjs scripts/learning/guard/guard.mjs
node /Users/xiwei/agent-remote-poc/scripts/learning/session-context.mjs
  → node /Users/xiwei/.agent-learning/guard/hook-shim.mjs scripts/learning/session-context.mjs
```

## 回滚

1. config 改回原路径（`install-shim.sh --apply` 会自动留 `config.json.bak.*`）。
2. 删除 `~/.agent-learning/guard/hook-shim.mjs` 与 `repo-root`。
3. 本分支不触碰冻结 SHA `15b04227`、PR #3、任何其它仓库。

## 残留风险 / 诚实边界

- 生产 Host 在 Owner 批准 config 重指之前**仍会报 Hook failed**（当前会话
  本身即是持续复现器）；沙箱已证明 shim 路径下不再复现。
- shim fail-open 意味着"脚本消失"降级为静默放行+审计——这是 Issue 要求的
  语义（不再污染所有会话），代价是保护空窗期变静默；`target-missing`
  审计行是唯一信号。
