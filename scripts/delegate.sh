#!/usr/bin/env bash
# Run one task on a free OpenCode model, headless, and print the worker's reply.
# Works anywhere with internet — local, Paseo, or a fresh Claude Code cloud
# container (installs OpenCode on first use; the free "opencode/*-free" models
# need no login or API key).
#
# Usage:
#   scripts/delegate.sh "task prompt"
#   scripts/delegate.sh -m opencode/nemotron-3.5-lightning-free -d /path/to/worktree "task prompt"
#   echo "task prompt" | scripts/delegate.sh
#   scripts/delegate.sh -t 300 "task prompt"   # give up after 5 min (default 20 min)
#
# Free models occasionally hang with no output. On a timeout (exit 124),
# retry with another model via -m (see the skill's model table).
#
# See .claude/skills/delegate-opencode/SKILL.md for when and how to delegate.
set -euo pipefail

MODEL="opencode/big-pickle"
DIR="$PWD"
TIMEOUT=1200
while getopts "m:d:t:" opt; do
  case "$opt" in
    m) MODEL="$OPTARG" ;;
    d) DIR="$OPTARG" ;;
    t) TIMEOUT="$OPTARG" ;;
    *) echo "usage: $0 [-m model] [-d dir] [-t seconds] \"prompt\"" >&2; exit 2 ;;
  esac
done
shift $((OPTIND - 1))
PROMPT="${1:-$(cat)}"

OC="$(command -v opencode || echo "$HOME/.opencode/bin/opencode")"
if [ ! -x "$OC" ]; then
  curl -fsSL https://opencode.ai/install | bash >/dev/null 2>&1
  OC="$HOME/.opencode/bin/opencode"
fi

cd "$DIR"
exec timeout "$TIMEOUT" "$OC" run -m "$MODEL" "$PROMPT"
