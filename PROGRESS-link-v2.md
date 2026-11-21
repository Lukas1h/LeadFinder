# FlambientLink → remote protocol v2 (cull + edit)

Branch `phone-link`. Files changed: `ios/LeadFinder/Features/Flambient/FlambientLink.swift` only.
`RemoteProtocol.swift` / `RemoteWire.swift` untouched (still byte-identical to the Mac copies,
checked with `diff`). Mock `ShootStore` and the screens untouched.

## What I changed

### Receiving (private(set) state on the link, v1 dictionary style)

All stored exactly as `.shootDetail` / `.sessionPreview` / `.cardPhoto` are, with no filtering by
shoot or angle:

| event | property | key |
|---|---|---|
| `.shootSession` | `shootSessions: [String: RemoteShootSession]` | path |
| `.cullList` | `cullLists: [String: RemoteCullList]` | path |
| `.photo` (JPEG body) | `photos: [String: [String: Data]]` | path, file |
| `.angleState` | `angleStates: [String: RemoteAngleState]` | `state.angle.id` |
| `.angleInputs` (payload body) | `angleInputs: [String: (inputsKey: String, data: Data)]` | angle id |
| `.undoState` | `undoStates: [String: RemoteUndoState]` | path |
| `.cullFocus` | `cullFocus: (path: String, item: String)?` + rising `cullFocusTick: Int` | — |

`cullFocus` is stored as the latest value *and* counted by `cullFocusTick`, because the same item
can be focused twice (undoing two decisions on it) and observing the value alone would miss the
repeat. Consumers should watch the tick.

v2 events also set `didHandshake = true`, same as every non-status v1 event: any event proves the
Mac answered this session, so a later drop is a hiccup and not a refused token.

### Sending (request helpers, `requestShootDetail` style)

`openShoot(path:)`, `closeShoot(path:)`, `requestCullList(path:)`,
`cullDecide(path:item:passed:)`, `cullMerge(path:item:)`, `cullSplit(path:item:at:)`,
`requestPhoto(path:file:)`, `undo(path:)`, `redo(path:)`, `requestAngleState(path:angle:)`,
`requestAngleInputs(path:angle:)`.

No helpers for `setLayer` / `setMask` / `setShapes` / `setAngleLook` / `setLayersVisible` /
`resetLayer`, as instructed: the next worker builds those from `FlambientCore` types. What they
need from the link is `nextSeq() -> Int`, which rises with every command the phone sends and is
`@ObservationIgnored` private state.

Nothing blocks sending on transport. The section comment states that v2 cull/edit only works over
Wi-Fi (the Mac answers a body command over Multipeer with `.error("Needs Wi-Fi")`), so the screens
get the Mac's own message through `lastError`. No change was needed in `FlambientWifiLink`: the
phone only ever sends JSON command headers, all bodies travel Mac → phone.

## Decisions the next worker should know about

- **Photo cache is bounded, like `cardPhotos`.** `photos` keeps the 30 most recently received
  frames across all shoots (`photoOrder` LRU); evicting removes the file and drops an empty shoot
  entry. Rationale: a 40-angle shoot is hundreds of MB of JPEGs on a phone. So `photos[path]?[file]`
  can disappear under the backend — treat a miss as "request it again", and don't assume a frame
  received once stays. 30 is one screen plus a look-ahead, matching the card-photo cap.
- **`angleInputs` is NOT bounded.** Prefetched inputs are megabytes each and the right eviction
  policy belongs to the backend's prefetch cache (plan §3), which is the thing that asks for them.
  The link only holds them. There is no pruning API yet; if the backend needs to drop an angle's
  inputs it has to add one (both properties are `private(set)`, so it can only read today).
- **Empty bodies are stored as they arrive.** `.photo`/`.angleInputs` with an empty body is stored
  as empty `Data`; the link doesn't invent an error state. The backend should treat empty as
  "not available" rather than decodable.
- **Stale inputs are the caller's job.** `angleInputs[angle].inputsKey` is kept next to the bytes so
  the backend can compare it with `RemoteAngleState.inputsKey` and re-request on a mismatch.
- `.angleInputs`' `path` is not stored (the requested key scheme is angle id). If angle ids ever
  collide across shoots, this needs a path-qualified key — worth a glance when the backend wires
  up.

## Done check

From `/Users/lukashahn/Developer/LeadFinder-wt-phone`:

    ios/generate.sh >/dev/null
    xcodebuild build -project ios/LeadFinder.xcodeproj -scheme LeadFinder \
      -destination 'generic/platform=iOS Simulator' -derivedDataPath /tmp/lf-dd-link

Result: **BUILD SUCCEEDED**, no `error:` lines, no warnings. The two pre-existing uncommitted
changes in the tree (`RemoteProtocol.swift` v2 and the `FlambientCore` package entry in
`project.yml`) were left as they were; they are what made the v2 cases exist.

No tests added: the link has no test target, and none of this is exercised until the Mac's session
side lands (it is on `phone-session`).
