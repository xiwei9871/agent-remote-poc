---
name: learning-health
description: Check the health of the Agent Learning installation — hooks, guard bundle hashes, AgentMemory daemon/MCP, candidate lessons, and recent hook WARNs. Use when the user reports "hook failed", missing memory, or asks whether learning is working.
---

# learning-health

Diagnose the installation, do not guess:
1. Run `./doctor.sh` from the package if available; otherwise check:
   `~/.agent-learning/guard/health.json`, bundle `manifest.sha256` verify,
   `agentmemory status`, and the Devin config hook entries.
2. `hook exit 1` WARNs in the Devin log are a KNOWN unattributed issue — a
   WARN count alone does not mean our hooks failed; check health.json first.
3. Report PASS / PARTIAL / FAIL per component with the concrete fix for
   each failure (e.g. `agentmemory` to start daemon, reinstall bundle).
