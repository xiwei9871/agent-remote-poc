---
name: evidence-verifier
description: Verify claims before reporting PASS — test results actually re-run green, git remote SHA actually equals local HEAD, deploys actually reachable. Use whenever the agent is about to report success.
---

# evidence-verifier

Never report success on intent:
- Tests: re-run the command; PASS requires the runner's own pass signal,
  not absence of visible errors.
- Git delivery: after push, `git ls-remote` and compare the remote ref SHA
  to local HEAD — a SHA-looking string alone is not verification.
- Deploy: hit the real endpoint/artifact, not just a "deployed" log line.
- Report each of build/test/deploy separately; label anything not run as
  NOT_VERIFIED.
