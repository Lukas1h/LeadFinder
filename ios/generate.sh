#!/bin/bash
# Regenerate LeadFinder.xcodeproj from project.yml. Run after adding a file to
# ios/LeadFinder/ — XcodeGen globs sources, so new files need a regen.
set -euo pipefail
cd "$(dirname "$0")"
xcodegen generate