# PR #7 整改报告 (P0_FIX_REQUIRED → 复审就绪)

针对 Owner 复审意见（2026-11-16）逐项整改，均在原分支
`fix/agent-learning-stop-exit1` 上完成。

## P0-1 仓库根路径算错 → FIXED

`REPO_ROOT` 由 `../..`(→`<repo>/scripts`)改为 `../../..`(→`<repo>`)。
新增 e2e 断言 `repo-root == <repo>` 且不以 `/scripts` 结尾。

## P0-2 "仓库外 shim" 仍依赖仓库内 guard → FIXED

安装器现在把**完整可运行 bundle** 装入
`~/.agent-learning/guard/`：

```
hook-shim.mjs            # 稳定入口
bin/guard.mjs            # 策略裁决实现(自带 HERE/policy.json)
bin/policy.json
bin/session-context.mjs
manifest.json            # 4 文件 sha256 + 字节数 + 版本 v2
repo-root                # 活动 checkout 优先解析指针
```

解析顺序不变(GUARD_HOME→pointer→bin),但第 3 级现在是**真实存在
的完整实现**,不是空头兜底。e2e 验证:repo-root 指向无 learning 的
checkout 时,E03(pkill -f)仍被安装版 guard `decision:block`。

## P0-3 PreToolUse 静默 fail-open → FIXED (按事件分级)

shim 解析 stdin 中 `hook_event_name` 分级:

| 事件 | 失败策略 |
|---|---|
| PreToolUse | **fail-closed**: 目标缺失/子进程崩溃/超时/裁决非法 → 输出真实 `{decision:"block", reason:"[shim:guard-unavailable] ..."}` |
| Stop/PostToolUse/SessionStart/unknown | fail-open + 审计 |

可观察性:除 `audit.jsonl` 外新增 `health.json`(`ok`/`degraded` +
why/event/target),故障状态不依赖人工翻日志。

## P1-4 数组索引盲改 config → FIXED

`--apply` 重写为**精确匹配**：

- 只重写 `command` 中匹配 `scripts/learning/{guard/guard.mjs|
  session-context.mjs}` 且路径含本仓库根或 hook-shim.mjs 的条目
- 其他事件/位置/外来 hook 一律 `skip` 并打印
- 备份 → 临时文件 → 重解析验证(变更集合=预期、其余逐条不变、
  条目总数不变)→ 原子 rename；验证失败自动放弃且保留备份
- 幂等:重复运行报告 `already installed`
- `--rollback` 恢复最新 `.bak.*`

e2e 覆盖:外来 hook/同 entry 兄弟 hook/无关 SessionStart[0] 均未动;
二次 apply 幂等;rollback 恢复原 command。

## P1-5 失败子进程部分 stdout → FIXED

仅当子进程 **exit 0** 且 stdout 为**空或完整可解析 JSON 对象**
才转发;否则丢弃、`bad-stdout` 审计、按事件分级处理
(PreToolUse → fail-closed)。合成反例 `"{not json"` 与
`PARTIAL+exit1` 均有测试。

## 隔离环境验证(全部 ACTUAL_RUN)

| 测试 | 结果 |
|---|---|
| `node --test guard.test.mjs` | **17/17 pass** |
| `node --test hook-shim.test.mjs` | **9/9 pass** |
| `node --test install-e2e.test.mjs` | **4/4 pass** |

e2e 场景(临时 HOME,未触碰真实 `~/.config/devin/config.json`):

1. 安装成功:4 文件 bundle + manifest + 正确 repo-root
2. 切到无 learning 的 checkout → bin 兜底 guard 仍 block E03
3. guard 完全缺失 → PreToolUse fail-closed block + health degraded
4. `--apply` 精确改写/幂等/`--rollback` 恢复

## 未做事项(按边界)

- **未执行真实 `--apply`**,未修改 `~/.config/devin/config.json` —
  等待 Owner 审批
- 未更新 PR #3 或其他冻结分支
- 未做真实 Devin Desktop UAT(按指示停在
  `NEEDS_OWNER_CONFIG_APPROVAL / OWNER_DESKTOP_UAT`)
