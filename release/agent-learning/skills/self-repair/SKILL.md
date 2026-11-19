---
name: self-repair
description: Perform only minimal, reversible fixes within authorized scope (L0/L1). Use when asked to fix something and the safe path is a small local change — never destructive, never out-of-scope rewrites.
---

# self-repair

Repair discipline:
- L0 = read-only diagnosis; L1 = minimal reversible edit in the requested
  scope. Anything beyond requires explicit owner approval first.
- Prefer existing conventions and the smallest diff that fixes the bug.
- Never: force-push, delete data, kill processes by pattern match, modify
  security policy, or "fix" things outside the stated scope.
- After the fix, run the narrowest real verification and report it plainly.
