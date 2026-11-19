#!/usr/bin/env bash
# build-dist.sh — reproducible packaging: sorted file list, neutral uid/gid,
# gzip -n strips the timestamp so identical content => identical sha256.
# Portable: bsdtar gets --no-mac-metadata, GNU tar does not support it.
set -euo pipefail
cd "$(dirname "$0")"
PKG="agent-learning"
OUT="dist/${PKG}-1.0.0.tar.gz"
mkdir -p dist
EXTRA=()
tar --version 2>/dev/null | grep -qi bsd && EXTRA+=(--no-mac-metadata)
COPYFILE_DISABLE=1 tar "${EXTRA[@]}" --uid 0 --gid 0 --numeric-owner \
  -cf - "$PKG" | gzip -n > "$OUT"
# sha256sum (GNU) / shasum (BSD) / node fallback — identical output format.
if command -v sha256sum >/dev/null 2>&1; then sha256sum "$OUT" | tee "$OUT.sha256"
elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$OUT" | tee "$OUT.sha256"
else node -e 'const c=require("node:crypto"),f=require("node:fs"),p=process.argv[1];console.log(c.createHash("sha256").update(f.readFileSync(p)).digest("hex")+"  "+p)' "$OUT" | tee "$OUT.sha256"
fi
