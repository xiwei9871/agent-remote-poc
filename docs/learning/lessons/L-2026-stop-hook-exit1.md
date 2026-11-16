---
lesson_id: L-2026-0002
scope: global
kind: error
trigger:
  when: "before relying on a user-level hook path that lives inside a git checkout"
  tool: "config"
  pattern: "hooks\\..*\\.command.*<repo>/"
wrong_action: >
  Registered user-level Devin hooks directly at
  /Users/xiwei/agent-remote-poc/scripts/learning/*.mjs. Switching the checkout
  to a branch without scripts/learning/ made every hook invocation die with
  MODULE_NOT_FOUND -> exit 1 -> "Hook failed" across ALL Devin projects, and
  silently disabled the PreToolUse E03 safety net.
root_cause: >
  Hook entry point lived inside mutable git state (branch contents). The
  deployment path and the code lifecycle were coupled; a routine `git
  checkout` removed the binary the hooks depended on.
correct_action: >
  User-level hook commands must point at a STABLE path outside the repo
  (installed shim ~/.agent-learning/guard/hook-shim.mjs) which resolves the
  real script via a repo-root pointer, audits missing/crashed targets, and
  always exits 0 (fail-open) so infrastructure faults never surface as
  "Hook failed" in unrelated sessions.
prevention_check:
  type: manual
  expr: "hook command paths must not contain a path inside a git worktree; audit.jsonl must show shim:* or rule entries, never host-side 'exited with code 1' from missing scripts"
  mode: warn
evidence:
  - docs/learning/STOP_HOOK_EXIT1_RCA.md
  - docs/learning/STOP_HOOK_UAT.md
  - docs/learning/evidence/stop-exit1/
confidence: high
status: CANDIDATE
supersedes: []
version: 1
last_verified: "2026-11-16"
source: tool-error
not_applicable_when: >
  Repo-local hooks intentionally registered per-branch, or hosts that already
  resolve hook scripts via package manager paths (npm global, ~/.local) rather
  than checkout paths.
---

# L-2026-stop-hook-exit1

症状：Devin 全局 Stop Hook `exited with code 1`，跨所有项目。
根因：hook 注册在 git checkout 内路径，分支切换使脚本消失 →
MODULE_NOT_FOUND → exit 1（Host 报 "Hook failed"）。
教训：**用户级 hook 入口必须指向仓库外稳定路径 + fail-open 委托 shim**；
缺失/崩溃只进审计，不污染会话。修复见 hook-shim.mjs（Issue #6）。
