#!/bin/bash
# Check that APIModels.swift can still decode what the API actually returns.
#
# Phase 2 found two model bugs this way — `jobDate` declared non-optional when
# the API sends null, and `invoiceNumber` declared a string when it's a number —
# both of which showed up as "the server sent data the app couldn't read" on a
# screen. Neither showed up as a build error, because the app compiles against
# the model, not against the data.
#
# Fetches the read endpoints and decodes each with the real model types.
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
for endpoint in leads follow-up schedule bookings agents messages presets; do
  curl -sf -H "Authorization: Bearer $SECRET" "$BASE/api/app/v1/$endpoint" -o "$WORK/$endpoint.json"
  printf '  %-12s %s bytes\n' "$endpoint" "$(wc -c < "$WORK/$endpoint.json" | tr -d ' ')"
done

# Portfolio links: the list, then one link's activity and builder state, plus
# the builder's lookups. All reads; nothing here creates or saves a link.
for endpoint in portfolio-links portfolio-links/catalog portfolio-links/overview bookings/gallery-visits; do
  name="$(echo "$endpoint" | tr / -)"
  curl -sf -H "Authorization: Bearer $SECRET" "$BASE/api/app/v1/$endpoint" -o "$WORK/$name.json"
  printf '  %-12s %s bytes\n' "$name" "$(wc -c < "$WORK/$name.json" | tr -d ' ')"
done
LINK_ID="$(python3 -c 'import json,sys; l=json.load(open(sys.argv[1]))["links"]; print(l[0]["id"] if l else "")' "$WORK/portfolio-links.json")"
if [ -n "$LINK_ID" ]; then
  curl -sf -H "Authorization: Bearer $SECRET" "$BASE/api/app/v1/portfolio-links/$LINK_ID" -o "$WORK/portfolio-activity.json"
  curl -sf -H "Authorization: Bearer $SECRET" "$BASE/api/app/v1/portfolio-links/$LINK_ID/edit" -o "$WORK/portfolio-edit.json"
  AGENT_ID="$(python3 -c 'import json,sys; a=json.load(open(sys.argv[1]))["agent"]; print(a["id"] if a else "")' "$WORK/portfolio-edit.json")"
  if [ -n "$AGENT_ID" ]; then
    curl -sf -H "Authorization: Bearer $SECRET" "$BASE/api/app/v1/portfolio-links/prefill?agent=$AGENT_ID" -o "$WORK/portfolio-prefill.json"
    curl -sf -H "Authorization: Bearer $SECRET" "$BASE/api/app/v1/portfolio-links/listing-photos?agent=$AGENT_ID" -o "$WORK/portfolio-photos.json"
  fi
fi
curl -sf -H "Authorization: Bearer $SECRET" "$BASE/api/app/v1/portfolio-links/agents?q=an" -o "$WORK/portfolio-agents.json"
curl -sf -H "Authorization: Bearer $SECRET" "$BASE/api/app/v1/portfolio-links/jobs?q=eu" -o "$WORK/portfolio-jobs.json"

# One message in full, for its quick actions: the newest text in the history.
MESSAGE_ID="$(python3 -c 'import json,sys; s=[x for x in json.load(open(sys.argv[1]))["sends"] if x["channel"]!="email"]; print(s[0]["id"] if s else "")' "$WORK/messages.json")"
if [ -n "$MESSAGE_ID" ]; then
  curl -sf -H "Authorization: Bearer $SECRET" "$BASE/api/app/v1/messages/$MESSAGE_ID" -o "$WORK/message.json"
  printf '  %-12s %s bytes\n' "message" "$(wc -c < "$WORK/message.json" | tr -d ' ')"
fi

cp LeadFinder/API/APIModels.swift "$WORK/APIModels.swift"
# APIModels relies on a String helper and DateFormatting from the Design
# layer. DateFormatting is a plain Foundation file, so it's compiled in as is;
# the String helper is stubbed because Theme.swift pulls in SwiftUI.
cp LeadFinder/Design/DateFormatting.swift "$WORK/DateFormatting.swift"
# Booking.costs is a FinanceModels type; that file is Foundation-only too.
cp LeadFinder/API/FinanceModels.swift "$WORK/FinanceModels.swift"
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
allOK = check("messages", "\\(dir)/messages.json", MessagesResponse.self) && allOK
allOK = check("presets", "\\(dir)/presets.json", PresetsResponse.self) && allOK
if FileManager.default.fileExists(atPath: "\\(dir)/message.json") {
    allOK = check("message", "\\(dir)/message.json", MessageDetailResponse.self) && allOK
}
struct AgentsList: Decodable { let agents: [PortfolioAgentMatch] }
struct JobsList: Decodable { let listings: [PortfolioListing] }
func checkIfThere<T: Decodable>(_ name: String, _ file: String, _ type: T.Type) -> Bool {
    FileManager.default.fileExists(atPath: file) ? check(name, file, type) : true
}
allOK = check("portfolio-links", "\(dir)/portfolio-links.json", PortfolioLinksResponse.self) && allOK
allOK = check("gallery-visits", "\(dir)/bookings-gallery-visits.json", GalleryVisitsResponse.self) && allOK
allOK = check("portfolio-overview", "\(dir)/portfolio-links-overview.json", PortfolioOverview.self) && allOK
allOK = check("portfolio-catalog", "\(dir)/portfolio-links-catalog.json", PortfolioCatalog.self) && allOK
allOK = checkIfThere("portfolio-activity", "\(dir)/portfolio-activity.json", PortfolioActivityResponse.self) && allOK
allOK = checkIfThere("portfolio-edit", "\(dir)/portfolio-edit.json", PortfolioEditResponse.self) && allOK
allOK = checkIfThere("portfolio-prefill", "\(dir)/portfolio-prefill.json", PortfolioPrefill.self) && allOK
allOK = checkIfThere("portfolio-photos", "\(dir)/portfolio-photos.json", PortfolioListingPhotosResponse.self) && allOK
allOK = check("portfolio-agents", "\(dir)/portfolio-agents.json", AgentsList.self) && allOK
allOK = check("portfolio-jobs", "\(dir)/portfolio-jobs.json", JobsList.self) && allOK
exit(allOK ? 0 : 1)
EOF

swiftc -O -o "$WORK/check" "$WORK/APIModels.swift" "$WORK/DateFormatting.swift" "$WORK/FinanceModels.swift" "$WORK/main.swift"
"$WORK/check"