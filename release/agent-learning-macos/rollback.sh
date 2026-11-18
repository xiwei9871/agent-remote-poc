#!/usr/bin/env bash
# rollback.sh — restore the Devin config to its state BEFORE this package
# modified it. Restores the newest installer backup only; never deletes
# memory data, never kills processes, never touches other tools' hooks.
set -euo pipefail

DEVIN_CONFIG="${DEVIN_CONFIG:-$HOME/.config/devin/config.json}"
bak="$(ls -1t "$DEVIN_CONFIG".bak.agentlearning-* 2>/dev/null | head -1 || true)"
if [[ -z "$bak" ]]; then
  echo "no installer backup found next to $DEVIN_CONFIG — nothing to roll back." >&2
  exit 1
fi
cp "$bak" "$DEVIN_CONFIG"
echo "rolled back: $DEVIN_CONFIG  <-  $bak"
echo "Note: installed files under ~/.agent-learning/ and skills are left in place"
echo "(inert without the hook entries). Run uninstall.sh to remove them."
