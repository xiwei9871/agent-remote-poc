#!/usr/bin/env bash
# Colleague entry point — delegates to the shipped package scripts so that
# `git clone && ./install.sh && ./doctor.sh` works exactly like the tarball.
exec "$(cd "$(dirname "$0")" && pwd)/release/agent-learning-macos/rollback.sh" "$@"
