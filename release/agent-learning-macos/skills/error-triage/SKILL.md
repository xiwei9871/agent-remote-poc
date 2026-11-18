---
name: error-triage
description: Diagnose tool, test, or review failures before retrying. Use when a command fails, tests break, a hook blocks, or the same error repeats — find the root cause instead of retrying blindly.
---

# error-triage

When something fails:
1. Capture the exact failing command, exit code, and first error lines.
2. Classify: environment / syntax / logic / external-service / flaky.
3. Check whether a Lesson already covers this failure (memory-recall) —
   repeated mistakes are exactly what the memory layer exists to prevent.
4. Fix the root cause, not the symptom; verify with the smallest real test.
5. If a Guard hook blocks your action, treat it as a signal: use the safer
   alternative the block reason suggests rather than working around it.
