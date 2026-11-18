#!/usr/bin/env bash
# build-dist.sh — reproducible packaging: sorted file list, neutral uid/gid,
# gzip -n strips the timestamp so identical content => identical sha256.
set -euo pipefail
cd "$(dirname "$0")"
OUT="dist/agent-learning-macos-1.0.0.tar.gz"
mkdir -p dist
COPYFILE_DISABLE=1 tar --no-mac-metadata --uid 0 --gid 0 --numeric-owner \
  -cf - agent-learning-macos | gzip -n > "$OUT"
shasum -a256 "$OUT" | tee "$OUT.sha256"
