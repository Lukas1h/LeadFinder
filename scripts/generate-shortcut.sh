#!/usr/bin/env bash
set -euo pipefail

# Regenerates public/leadfinder-import.shortcut — the iOS share-sheet
# Shortcut offered for download on the Settings page (see
# src/app/settings/page.tsx). It POSTs a shared Zillow URL straight to
# /api/import-listing, so the domain and IMPORT_SHARE_SECRET both get baked
# into the file at generation time. Re-run this (and commit the result)
# whenever either changes.
#
# Requires, both macOS-only:
#   - cherri (compiles the .cherri source below to a real Shortcut plist):
#     brew tap electrikmilk/cherri && brew install electrikmilk/cherri/cherri
#   - `shortcuts` (Apple's own CLI, ships with macOS 12+) to sign it —
#     unsigned .shortcut files can no longer be imported on iOS at all as of
#     iOS 15. --mode anyone produces a file any device can import (with an
#     "Add Untrusted Shortcut" prompt reviewing its actions), vs the
#     --mode people-who-know-me default which only trusts your own devices.
#
# There's no way to sign on Vercel's (Linux) build machine, so this can't
# run automatically on deploy — it's a manual step, same as the splash
# image generation under public/splash/.

cd "$(dirname "$0")/.."

DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then
  echo "Usage: scripts/generate-shortcut.sh <https://your-deployed-domain>" >&2
  exit 1
fi
DOMAIN="${DOMAIN%/}"

if [ -z "${IMPORT_SHARE_SECRET:-}" ]; then
  echo "IMPORT_SHARE_SECRET is not set — source .env.local first:" >&2
  echo "  set -a; source .env.local; set +a; scripts/generate-shortcut.sh $DOMAIN" >&2
  exit 1
fi

command -v cherri >/dev/null || {
  echo "cherri not found. Install it with:" >&2
  echo "  brew tap electrikmilk/cherri && brew install electrikmilk/cherri/cherri" >&2
  exit 1
}
command -v shortcuts >/dev/null || {
  echo "The 'shortcuts' CLI wasn't found — it ships with macOS 12+ at /usr/bin/shortcuts." >&2
  exit 1
}

workdir=$(mktemp -d)
trap 'rm -rf "$workdir"' EXIT

cat > "$workdir/import.cherri" <<CHERRI
#define name: Import to LeadFinder
#define color: red
#define glyph: house
#define inputs: url, webpage
#define from: sharesheet

#include 'actions/web'

@input = ShortcutInput

@result = jsonRequest("${DOMAIN}/api/import-listing", "POST", {
	"url": "{@input}"
}, {
	"Authorization": "Bearer ${IMPORT_SHARE_SECRET}"
})

showNotification("{@result}", "LeadFinder")
CHERRI

(cd "$workdir" && cherri import.cherri --skip-sign >/dev/null)

unsigned=$(find "$workdir" -maxdepth 1 -name "*_unsigned.shortcut")
if [ -z "$unsigned" ]; then
  echo "cherri didn't produce an unsigned .shortcut file — see its output above." >&2
  exit 1
fi

shortcuts sign --mode anyone --input "$unsigned" --output public/leadfinder-import.shortcut

echo "Wrote public/leadfinder-import.shortcut for $DOMAIN"
