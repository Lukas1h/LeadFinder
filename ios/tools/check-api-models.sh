#!/bin/bash
# Check that APIModels.swift can still decode what the API actually returns.
#
# Phase 2 found two model bugs this way — `jobDate` declared non-optional when
# the API sends null, and `invoiceNumber` declared a string when it's a number —
# both of which showed up as "the server sent data the app couldn't read" on a
# screen. Neither showed up as a build error, because the app compiles against
# the model, not against the data.
#
# Fetches the five read endpoints and decodes each with the real model types.
# Read-only: nothing here writes.
#
# Usage: ios/tools/check-api-models.sh
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(cd .. && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

SECRET="$(grep '^MOBILE_API_SECRET=' "$ROOT/.env.local" | cut -d= -f2- | tr -d '"')"
if [ -z "$SECRET" ]; then
  echo "MOBILE_API_SECRET not found in .env.local" >&2
  exit 1
fi
# `//` starts a comment in xcconfig, so the URL is written https:/$()/host —
# strip the escape back out to get the real URL.
BASE="$(grep '^MOBILE_API_BASE_URL' Config/Base.xcconfig | sed 's/.*= *//; s|/\$()/|//|')"
BASE="${BASE:-https://realestate.lukashahn.art}"

echo "Fetching from $BASE"
for endpoint in leads follow-up schedule bookings agents; do
  curl -sf -H "Authorization: Bearer $SECRET" "$BASE/api/app/v1/$endpoint" -o "$WORK/$endpoint.json"
  printf '  %-12s %s bytes\n' "$endpoint" "$(wc -c < "$WORK/$endpoint.json" | tr -d ' ')"
done

cp LeadFinder/API/APIModels.swift "$WORK/APIModels.swift"
# APIModels relies on a String helper and DateFormatting from the Design
# layer. DateFormatting is a plain Foundation file, so it's compiled in as is;
# the String helper is stubbed because Theme.swift pulls in SwiftUI.
cp LeadFinder/Design/DateFormatting.swift "$WORK/DateFormatting.swift"
cat >> "$WORK/APIModels.swift" <<'EOF'

extension String {
    var nilIfBlank: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
EOF

cat > "$WORK/main.swift" <<EOF
import Foundation

func codingPath(_ ctx: DecodingError.Context) -> String {
    ctx.codingPath.map(\.stringValue).joined(separator: ".")
}

func check<T: Decodable>(_ name: String, _ file: String, _ type: T.Type) -> Bool {
    do {
        let data = try Data(contentsOf: URL(fileURLWithPath: file))
        _ = try JSONDecoder().decode(T.self, from: data)
        print("OK   \\(name)")
        return true
    } catch let error as DecodingError {
        switch error {
        case let .keyNotFound(key, ctx):
            print("FAIL \\(name): missing key '\\(key.stringValue)' at '\\(codingPath(ctx))'")
        case let .typeMismatch(type, ctx):
            print("FAIL \\(name): expected \\(type) at '\\(codingPath(ctx))'")
        case let .valueNotFound(type, ctx):
            print("FAIL \\(name): null where \\(type) expected at '\\(codingPath(ctx))'")
        case let .dataCorrupted(ctx):
            print("FAIL \\(name): corrupted at '\\(codingPath(ctx))': \\(ctx.debugDescription)")
        @unknown default:
            print("FAIL \\(name): \\(error)")
        }
        return false
    } catch {
        print("FAIL \\(name): \\(error)")
        return false
    }
}

let dir = "$WORK"
var allOK = true
allOK = check("leads", "\\(dir)/leads.json", LeadsResponse.self) && allOK
allOK = check("follow-up", "\\(dir)/follow-up.json", FollowUpResponse.self) && allOK
allOK = check("schedule", "\\(dir)/schedule.json", ScheduleResponse.self) && allOK
allOK = check("bookings", "\\(dir)/bookings.json", BookingsResponse.self) && allOK
allOK = check("agents", "\\(dir)/agents.json", AgentsResponse.self) && allOK
exit(allOK ? 0 : 1)
EOF

swiftc -O -o "$WORK/check" "$WORK/APIModels.swift" "$WORK/DateFormatting.swift" "$WORK/main.swift"
"$WORK/check"