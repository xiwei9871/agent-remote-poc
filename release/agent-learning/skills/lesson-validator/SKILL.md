---
name: lesson-validator
description: Validate a candidate Lesson before it becomes enforced — check evidence, counterexamples, conflicts with existing lessons, and whether it duplicates or supersedes an older rule.
---

# lesson-validator

Before promoting a candidate Lesson to VALIDATED/ENFORCED:
- Evidence: cite the real session/artifact where the correction happened.
- Counterexamples: search memory for cases where the rule would misfire.
- Dedup: same-rule-different-wording lessons get merged, not stacked.
- Supersede: newer lessons explicitly revoke/replace contradicting older
  ones instead of coexisting ambiguously.
- Output: VALIDATED (with evidence refs) or REJECTED (with reason).
