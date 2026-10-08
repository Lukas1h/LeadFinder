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
#   scripts/delegate.sh -x "task prompt"        # --pure: no external plugins
#
# Free models occasionally hang with no output. On a timeout (exit 124),
# retry with another model via -m (see the skill's model table).
#
# See .claude/skills/delegate-opencode/SKILL.md for when and how to delegate.
set -euo pipefail

MODEL="opencode/big-pickle"
DIR="$PWD"
PURE=""
TIMEOUT=1200
while getopts "m:d:t:x" opt; do
  case "$opt" in
    m) MODEL="$OPTARG" ;;
    d) DIR="$OPTARG" ;;
    t) TIMEOUT="$OPTARG" ;;
    x) PURE="--pure" ;;
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

# `timeout` is GNU coreutils and isn't on stock macOS; `gtimeout` comes with
# `brew install coreutils`. Without either, run unbounded and let the caller
# background the job and poll its log.
if command -v timeout >/dev/null 2>&1; then
  exec timeout "$TIMEOUT" "$OC" run ${PURE:+$PURE} -m "$MODEL" "$PROMPT"
elif command -v gtimeout >/dev/null 2>&1; then
  exec gtimeout "$TIMEOUT" "$OC" run ${PURE:+$PURE} -m "$MODEL" "$PROMPT"
else
  echo "note: no timeout/gtimeout on this machine, running unbounded (piping will still end the run)" >&2
  exec "$OC" run ${PURE:+$PURE} -m "$MODEL" "$PROMPT"
fi
