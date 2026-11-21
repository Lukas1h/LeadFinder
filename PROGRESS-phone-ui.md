# Progress: phone cull + edit UI (LeadFinder-wt-phone, branch phone-link)

Worker: the Opus UI agent for `ios/LeadFinder/Features/Flambient/Edit/` (the screens
against the mock `ShootStore`; the Wi-Fi backend is other workers, see
`RealEstate/phone-edit-plan.md`).

## Files
- `ios/LeadFinder/Features/Flambient/Edit/ShootStore.swift` — the fixed API
  (`CullCard`, `PhoneLayer`, `Mask`, `EditPhase`, `MaskPreset`) as one
  `@Observable @MainActor final class` with a `static func mock()`. Undo is
  whole-state snapshots; a drag (`.began` … `.ended`) coalesces into one step.
  An injectable `Backend` closure set (`photo`, `undo`, `redo`, `selectAngle`)
  is where the real Wi-Fi store hooks in; nil = mock behaviour. The mock
  renders a generated 1200×800 placeholder (gradient + a bright "window"
  rectangle so mask tools have something to aim at).
- `CullScreen.swift` — full-screen frame (`ZoomableImage`: pinch, pan, double
  tap), swipe right/left to pass/reject with haptic + fly-out + tilt, verdict
  stamp, tap cycles frames, filmstrip with pass/reject state, ellipsis menu
  (merge with next / split here / flip verdict), warnings as chips, prefetch
  of the current item's frames plus the next three items.
- `EditScreen.swift` — canvas (pinch, pan, double tap), press-and-hold
  before/after (works via the badge even in poly mode), horizontal swipe or
  top angle strip to change angle, bottom sheet with detents
  (`.height(170)`, `.medium`, `.large`; background interactive up through
  medium so mask tools stay usable with the sheet open): layer list (eye
  toggle, long-press solo, blend/exposure/opacity/mask summary), per-layer
  exposure/opacity sliders, blend picker, mask bar (Whole / Keep L / Keep R /
  Gradient / Poly), angle exposure + highlights. `CanvasMap` maps normalized
  image points through aspect-fit + zoom + pan for both directions.
  Gradient: two draggable handles + dashed line. Poly: tap to add, tap first
  point to close, drag with a 3× loupe, long-press point to delete it,
  long-press inside a polygon to delete it, Done finishes (drops < 3 points).
  Drags report began/changed/ended; adds/deletes report discrete. Overlay
  state is local during drags; only the store is called.
- `ShootWorkspace.swift` — `NavigationStack` + segmented Cull | Edit; shared
  toolbar undo/redo (both modes use the Mac's single history) with haptics.
- `FlambientView.swift` — "Cull & Edit" button in `FlambientShootDetailView`
  presenting `ShootWorkspace(store: .mock())` as a full-screen cover, with
  `// TODO(wire): real store for shoot path`. Rest of the layout untouched.

## Fixes while finishing
- Card swap after a verdict: the thrown card used to cross-fade back to
  centre; removal is now instant (`.identity`) with an animated insert, and
  the last card springs back instead of snapping.
- Undo jump: `cullFocus` is now one-shot (the screen clears it after
  jumping) so a second undo pointing at the same item still jumps.

## API deviations
None. Everything the spec lists is on `ShootStore` with the exact names.
Two notes, not deviations:
- Undo/redo live in `ShootWorkspace`'s toolbar rather than once per screen —
  one shared history for both modes; each screen's own toolbar items (cull
  menu, edit reset) sit beside them.
- `cullFocus` is one-shot: the cull screen clears it after jumping. The real
  backend should treat it the same way (set it after every undo/redo that
  concerns a cull item).

## Checks
- `ios/generate.sh` + `xcodebuild build -destination 'generic/platform=iOS Simulator'`:
  BUILD SUCCEEDED (`/tmp/lfbuild-ui.log`).
- `RemoteWire.swift` is byte-identical with the Mac's `phone-link` worktree.
  `RemoteProtocol.swift` differs **by prior commits, not by this worker**: the
  Mac's `phone-link` has protocol v2 (ef58356) while the iOS copy is still v1;
  copying v2 to iOS is the handoff's separate "next steps" item.
- No device/simulator run (rules forbid launching; screenshots optional).

## Left for the backend worker
- Wire `ShootStore.Backend` (or replace the mock's local edits) to the v2
  commands; keep the view-facing API exactly as is.
- The mock's `photo(_:)` sleeps 60 ms and generates a placeholder; the real
  one serves `.photo` bodies.
- Landscape is locked to portrait app-wide by the existing Info.plist.
