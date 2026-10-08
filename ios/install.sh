#!/bin/bash
# Build LeadFinder for the connected iPhone, install it, and launch it.
#
# Requires the Apple ID to be added in Xcode ▸ Settings ▸ Accounts. Without it
# Xcode can't mint the provisioning profile, and the build fails with
# "No profiles for 'art.lukashahn.LeadFinder' were found".
#
# A free Personal Team signs for 7 days; after that run this again (or set up
# SideStore — see docs/ios-app-plan.md).
set -euo pipefail

cd "$(dirname "$0")"

DEVICE="${1:-}"
if [ -z "$DEVICE" ]; then
  # First available (paired) iPhone, by its Xcode destination id.
  DEVICE="$(xcodebuild -project LeadFinder.xcodeproj -scheme LeadFinder -showdestinations 2>/dev/null \
    | grep 'platform:iOS, arch:' \
    | sed 's/.*id:\([^,]*\),.*/\1/' \
    | head -1)"
fi
if [ -z "$DEVICE" ]; then
  echo "No iPhone connected. Plug it in (or trust this Mac) and retry." >&2
  exit 1
fi
echo "Building for device $DEVICE"

xcodebuild -project LeadFinder.xcodeproj -scheme LeadFinder \
  -sdk iphoneos -destination "id=$DEVICE" \
  -derivedDataPath /tmp/lf-dd-device \
  -allowProvisioningUpdates \
  build | grep -E "error:|warning:|BUILD" || true

APP="/tmp/lf-dd-device/Build/Products/Debug-iphoneos/LeadFinder.app"
[ -d "$APP" ] || { echo "Build failed — no app at $APP" >&2; exit 1; }

# devicectl takes the CoreDevice id, which is not the same string as the Xcode
# destination id, so look it up by name.
CORE_ID="$(xcrun devicectl list devices 2>/dev/null \
  | grep -v 'unavailable' \
  | grep -i 'iphone' \
  | awk '{print $4}' \
  | head -1)"

echo "Installing on $CORE_ID"
xcrun devicectl device install app --device "$CORE_ID" "$APP"

echo "Launching"
xcrun devicectl device process launch --device "$CORE_ID" art.lukashahn.LeadFinder