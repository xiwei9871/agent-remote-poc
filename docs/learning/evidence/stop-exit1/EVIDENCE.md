# 脱敏证据 — stop-exit1（Issue #6）

以下均为本机 2026-11-16 实机取证节选；路径与字段已核对无私有内容。

## 1. Host 日志（devin_20261116-111927_68806.log，GPR 会话）

```
2026-11-16T04:10:57.168Z WARN agent_ext::hooks::event_handler:
  Effects evaluator failed for hook None: Command exited with code 1 (exit code: 1)
2026-11-16T04:11:03.426Z WARN ... exited with code 1
2026-11-16T04:11:22.911/913/913Z WARN ... exited with code 1 ×3
... (其后持续，PreToolUse/PostToolUse/Stop 同形态)
```

## 2. audit.jsonl 断流

```
最后条目: 2026-11-16T04:09:13.283Z  {"evt":null,"rule":"E04-FALSE-PASS-CLAIM",...}
文件 mtime: Nov 16 12:09:13 2026（=04:09 UTC）
之后 0 条 → 失败期间脚本进程未启动
```

## 3. git reflog（agent-remote-poc 主 checkout）

```
63b935a HEAD@{0} commit: Model config ...
92d2c18 HEAD@{1} commit: Gate 2 evidence ...
        HEAD@{2} checkout: moving from research/agent-learning-global-v1
                           to research/dsh-remote-gate2-v02
15b0422 HEAD@{3} commit: (冻结 SHA)
```

`git ls-tree HEAD scripts/` → 空；`git ls-tree 15b04227 scripts/learning/` → 存在。
分支切换 = audit 断流与 Host 报错之间的唯一变更。

## 4. 确定性重现

```
$ node /Users/xiwei/agent-remote-poc/scripts/learning/guard/guard.mjs
node:internal/modules/cjs/loader:1459  throw err;
Error: Cannot find module '.../guard/guard.mjs'  code: 'MODULE_NOT_FOUND'
exit=1
```

## 5. 注册证据（~/.config/devin/config.json，凭据不输出）

```
hooks.PreToolUse[0].hooks[0].command  = node /Users/xiwei/agent-remote-poc/scripts/learning/guard/guard.mjs   matcher=^(exec|kill_shell|write_to_process|write|edit|apply_patch)$ timeout=5
hooks.PostToolUse[0].hooks[0].command = node /Users/xiwei/agent-remote-poc/scripts/learning/guard/guard.mjs   matcher=^(exec)$ timeout=5
hooks.Stop[0].hooks[0].command        = node /Users/xiwei/agent-remote-poc/scripts/learning/guard/guard.mjs   timeout=5
hooks.SessionStart[1].hooks[0].command= node /Users/xiwei/agent-remote-poc/scripts/learning/session-context.mjs timeout=5
```
