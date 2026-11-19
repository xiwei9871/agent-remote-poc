---
name: lesson-distiller
description: EXPERIMENTAL — draft a structured candidate Lesson after a real correction. Use when the user corrects the agent and the lesson is worth remembering. Candidate only — auto-persistence is NOT yet verified; a human confirms before it counts.
---

# lesson-distiller (EXPERIMENTAL)

After a real user correction, distill a candidate Lesson:

1. Trigger: what exact behavior was corrected (quote, don't paraphrase).
2. Root cause: why the original behavior was wrong.
3. Rule: one imperative sentence, specific enough to enforce.
4. Scope: global / project / session; confidence CANDIDATE until validated.
5. Present the candidate to the user — do NOT silently save. Auto-capture
   (`memory_lesson_save` without prompting) is not yet verified end-to-end;
   a saved lesson must have a human or validated-test signal behind it.
