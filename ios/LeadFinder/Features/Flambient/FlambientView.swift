#if os(iOS)

import SwiftUI

// MARK: - Actions

/// Everything the dashboard can ask the Mac to do, as closures, so the
/// dashboard can be previewed with fake data and no `FlambientLink`.
struct FlambientActions {
    var refresh: () -> Void = {}
    var pair: (_ mac: String, _ code: String) -> Void = { _, _ in }
    var importSession: (_ card: String, _ session: Date, _ address: String, _ bookingId: String?) -> Void = { _, _, _, _ in }
    var cancelImport: (String) -> Void = { _ in }
    var ejectCard: (String) -> Void = { _ in }
    var planShoot: (String) -> Void = { _ in }
    var requestShootDetail: (String) -> Void = { _ in }
    var requestSessionPreview: (_ card: String, _ session: Date, _ limit: Int) -> Void = { _, _, _ in }
    var requestCardPhoto: (_ card: String, _ path: String) -> Void = { _, _ in }
    var setStayAwake: (Bool) -> Void = { _ in }
    var setAutoImport: (Bool) -> Void = { _ in }

    @MainActor static func live(_ link: FlambientLink) -> FlambientActions {
        FlambientActions(
            refresh: { link.refresh() },
            pair: { link.pair(mac: $0, code: $1) },
            importSession: { link.importSession(card: $0, session: $1, address: $2, bookingId: $3) },
            cancelImport: { link.cancelImport(importID: $0) },
            ejectCard: { link.ejectCard(cardID: $0) },
            planShoot: { link.planShoot(path: $0) },
            requestShootDetail: { link.requestShootDetail(path: $0) },
            requestSessionPreview: { link.requestSessionPreview(card: $0, session: $1, limit: $2) },
            requestCardPhoto: { link.requestCardPhoto(card: $0, path: $1) },
            setStayAwake: { link.setStayAwake($0) },
            setAutoImport: { link.setAutoImport($0) }
        )
    }
}

struct FlambientShootRoute: Hashable {
    let path: String
    let name: String
}

/// A session still on a card, before it's imported.
struct FlambientCardSessionRoute: Hashable {
    let cardID: String
    let sessionID: Date
}

// MARK: - Screen

/// Remote control for Flambient on the Mac, used at a glance while driving
/// home with the MacBook lid-closed in a backpack.
struct FlambientView: View {
    @State private var link = FlambientLink.shared

    var body: some View {
        FlambientDashboard(
            connection: link.connection,
            status: link.status,
            lastStatusAt: link.lastStatusAt,
            lastError: link.lastError,
            nearbyMacs: link.nearbyMacs,
            shootDetails: link.shootDetails,
            sessionPreviews: link.sessionPreviews,
            cardPhotos: link.cardPhotos,
            actions: .live(link)
        )
        .onAppear { link.start() }
    }
}

struct FlambientDashboard: View {
    @Environment(AppState.self) private var appState
    let connection: FlambientLink.Connection
    let status: RemoteStatus?
    let lastStatusAt: Date?
    let lastError: String?
    let nearbyMacs: [String]
    let shootDetails: [String: RemoteShootDetail]
    var sessionPreviews: [String: RemoteSessionPreview] = [:]
    var cardPhotos: [String: Data] = [:]
    let actions: FlambientActions

    @State private var importTarget: ImportTarget?

    struct ImportTarget: Identifiable {
        let cardID: String
        let session: RemoteSession
        var id: String { cardID + "\(session.id.timeIntervalSince1970)" }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                FlambientHeader(connection: connection, status: status, lastStatusAt: lastStatusAt, nearbyMacs: nearbyMacs)

                if let lastError {
                    ErrorBanner(message: lastError, onRetry: actions.refresh)
                }
                if case .needsPairing(let mac) = connection {
                    PairingCard(mac: mac, pair: actions.pair)
                }
                if let status {
                    if !status.imports.isEmpty { importsSection(status.imports) }
                    cardsSection(status.cards)
                    shootsSection(status.shoots)
                    settingsSection(status)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .refreshable { actions.refresh() }
        .background(Theme.background)
        .navigationTitle("Flambient")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(for: FlambientShootRoute.self) { route in
            FlambientShootDetailView(
                route: route,
                shoot: status?.shoots.first { $0.id == route.path },
                detail: shootDetails[route.path],
                actions: actions
            )
        }
        .navigationDestination(for: FlambientCardSessionRoute.self) { route in
            FlambientCardSessionView(
                route: route,
                session: status?.cards.first { $0.id == route.cardID }?.sessions.first { $0.id == route.sessionID },
                preview: sessionPreviews[FlambientLink.sessionKey(card: route.cardID, session: route.sessionID)],
                cardPhotos: cardPhotos,
                actions: actions
            )
        }
        .sheet(item: $importTarget) { target in
            FlambientImportSheet(
                session: target.session,
                bookings: appState.bookings.value.map { FlambientBookingMatch.candidates(for: target.session, in: $0) } ?? []
            ) { address, bookingId in
                actions.importSession(target.cardID, target.session.id, address, bookingId)
            }
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
    }

    // MARK: Sections

    private func sectionTitle(_ title: String) -> some View {
        Text(title)
            .font(.headline)
            .foregroundStyle(Theme.primaryText)
    }

    private func importsSection(_ imports: [RemoteImport]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionTitle("Imports")
            ForEach(imports) { item in
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text(item.shootName)
                            .font(.body.weight(.semibold))
                            .foregroundStyle(Theme.primaryText)
                            .lineLimit(1)
                        Spacer()
                        BadgeChip(text: item.state.capitalized, tint: Self.importTint(item.state))
                    }
                    ProgressView(value: min(max(item.progress, 0), 1))
                        .tint(Self.importTint(item.state))
                    HStack {
                        Text(item.detail ?? "\(Int(item.progress * 100))%")
                            .font(.caption)
                            .foregroundStyle(Theme.secondaryText)
                            .lineLimit(1)
                        Spacer()
                        if Self.isActive(item.state) {
                            Button("Cancel", role: .destructive) { actions.cancelImport(item.id) }
                                .buttonStyle(.bordered)
                                .tint(Theme.danger)
                        }
                    }
                }
                .card(padding: 14)
            }
        }
    }

    private func cardsSection(_ cards: [RemoteCard]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionTitle("Cards")
            if cards.isEmpty {
                Text("No card inserted")
                    .font(.subheadline)
                    .foregroundStyle(Theme.tertiaryText)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .card(padding: 14)
            }
            ForEach(cards) { card in
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Image(systemName: "sdcard.fill").foregroundStyle(Theme.sky)
                        Text(card.name)
                            .font(.body.weight(.semibold))
                            .foregroundStyle(Theme.primaryText)
                        if card.isScanning {
                            ProgressView().controlSize(.small)
                        }
                        Spacer()
                        Button {
                            actions.ejectCard(card.id)
                        } label: {
                            Label("Eject", systemImage: "eject.fill")
                        }
                        .buttonStyle(.bordered)
                        .tint(Theme.secondaryText)
                    }
                    ForEach(card.sessions) { session in
                        sessionRow(session, cardID: card.id)
                        if session.id != card.sessions.last?.id {
                            Divider().overlay(Theme.hairline)
                        }
                    }
                }
                .card(padding: 14)
            }
        }
    }

    private func sessionRow(_ session: RemoteSession, cardID: String) -> some View {
        let preview = sessionPreviews[FlambientLink.sessionKey(card: cardID, session: session.id)]
        return VStack(alignment: .leading, spacing: 10) {
            NavigationLink(value: FlambientCardSessionRoute(cardID: cardID, sessionID: session.id)) {
                FlambientSessionSpan(preview: preview, photoCount: session.photos)
                    .opacity(session.importedAs == nil ? 1 : 0.5)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            sessionInfo(session, cardID: cardID)
        }
        .onAppear { actions.requestSessionPreview(cardID, session.id, 2) }
    }

    private func sessionInfo(_ session: RemoteSession, cardID: String) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(Self.timeRange(session))
                    .font(.body.weight(.medium))
                    .foregroundStyle(session.importedAs == nil ? Theme.primaryText : Theme.tertiaryText)
                Text(Self.counts(session))
                    .font(.caption)
                    .foregroundStyle(Theme.secondaryText)
                if let imported = session.importedAs {
                    Text("Imported as \(imported)")
                        .font(.caption)
                        .foregroundStyle(Theme.tertiaryText)
                        .lineLimit(1)
                } else if let suggested = session.suggestedAddress {
                    Text(suggested)
                        .font(.caption)
                        .foregroundStyle(Theme.secondaryText)
                        .lineLimit(1)
                }
            }
            Spacer()
            if session.importedAs == nil {
                Button("Import") {
                    importTarget = ImportTarget(cardID: cardID, session: session)
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.accent)
                .foregroundStyle(.black)
            }
        }
    }

    private func shootsSection(_ shoots: [RemoteShoot]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionTitle("Shoots")
            if shoots.isEmpty {
                Text("No shoots yet")
                    .font(.subheadline)
                    .foregroundStyle(Theme.tertiaryText)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .card(padding: 14)
            } else {
                VStack(spacing: 0) {
                    ForEach(shoots) { shoot in
                        NavigationLink(value: FlambientShootRoute(path: shoot.id, name: shoot.name)) {
                            HStack(spacing: 10) {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(shoot.name)
                                        .font(.body.weight(.medium))
                                        .foregroundStyle(Theme.primaryText)
                                        .lineLimit(1)
                                    Text([shoot.date?.formatted(date: .abbreviated, time: .omitted),
                                          shoot.angles.map { "\($0) angles" } ?? "\(shoot.photos) photos"]
                                        .compactMap { $0 }.joined(separator: " · "))
                                        .font(.caption)
                                        .foregroundStyle(Theme.secondaryText)
                                }
                                Spacer()
                                BadgeChip(text: shoot.stage.capitalized, tint: shoot.planned ? Theme.emerald : Theme.slate)
                                Image(systemName: "chevron.right")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(Theme.tertiaryText)
                            }
                            .padding(.vertical, 12)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        if shoot.id != shoots.last?.id {
                            Divider().overlay(Theme.hairline)
                        }
                    }
                }
                .padding(.horizontal, 14)
                .background(Theme.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.border, lineWidth: 0.5))
            }
        }
    }

    private func settingsSection(_ status: RemoteStatus) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionTitle("Settings")
            VStack(alignment: .leading, spacing: 12) {
                Toggle("Auto-import cards", isOn: Binding(
                    get: { status.autoImport },
                    set: { actions.setAutoImport($0) }
                ))
                Divider().overlay(Theme.hairline)
                VStack(alignment: .leading, spacing: 4) {
                    Toggle("Keep Mac awake (lid closed)", isOn: Binding(
                        get: { status.stayingAwake },
                        set: { actions.setStayAwake($0) }
                    ))
                    .disabled(!status.stayAwakeReady)
                    if !status.stayAwakeReady {
                        Text("Set up once in Flambient on the Mac")
                            .font(.caption)
                            .foregroundStyle(Theme.tertiaryText)
                    }
                }
            }
            .tint(Theme.accent)
            .foregroundStyle(Theme.primaryText)
            .card(padding: 14)
        }
    }

    // MARK: Formatting

    static func importTint(_ state: String) -> Color {
        switch state.lowercased() {
        case "done": Theme.emerald
        case "failed", "cancelled", "canceled": Theme.danger
        case "planning": Theme.violet
        default: Theme.sky
        }
    }

    static func isActive(_ state: String) -> Bool {
        !["done", "failed", "cancelled", "canceled"].contains(state.lowercased())
    }

    static func timeRange(_ session: RemoteSession) -> String {
        let day = session.start.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
        let from = session.start.formatted(date: .omitted, time: .shortened)
        let to = session.end.formatted(date: .omitted, time: .shortened)
        return "\(day), \(from) – \(to)"
    }

    static func counts(_ session: RemoteSession) -> String {
        var parts = ["\(session.photos) photo\(session.photos == 1 ? "" : "s")"]
        if session.videos > 0 { parts.append("\(session.videos) video\(session.videos == 1 ? "" : "s")") }
        return parts.joined(separator: " · ")
    }
}

// MARK: - Header

struct FlambientHeader: View {
    let connection: FlambientLink.Connection
    let status: RemoteStatus?
    let lastStatusAt: Date?
    let nearbyMacs: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(tint)
                    .frame(width: 44, height: 44)
                    .background(tint.opacity(0.15), in: Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text(status?.macName ?? connection.macName ?? "Flambient")
                        .font(.title3.weight(.bold))
                        .foregroundStyle(Theme.primaryText)
                        .lineLimit(1)
                    Text(stateLabel)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(tint)
                }
                Spacer()
                if !connection.isConnected, connection != .idle {
                    ProgressView()
                }
            }

            if connection.isConnected, let status {
                HStack(spacing: 6) {
                    if let lastStatusAt {
                        TimelineView(.periodic(from: .now, by: 1)) { context in
                            BadgeChip(text: "Updated \(Self.ago(lastStatusAt, now: context.date))", tint: Theme.secondaryText, icon: "clock")
                        }
                    }
                    if let battery = status.battery {
                        BadgeChip(
                            text: "\(Int((battery <= 1 ? battery * 100 : battery).rounded()))%",
                            tint: status.charging == true ? Theme.emerald : (battery <= 0.2 || (battery > 1 && battery <= 20) ? Theme.danger : Theme.secondaryText),
                            icon: status.charging == true ? "battery.100.bolt" : "battery.50"
                        )
                    }
                    if status.stayingAwake {
                        BadgeChip(text: "Staying awake", tint: Theme.violet, icon: "cup.and.saucer.fill")
                    }
                }
                if !["nominal", "fair"].contains(status.thermal.lowercased()) {
                    banner("Mac is running hot (\(status.thermal))", icon: "thermometer.high", tint: Theme.orange)
                }
                if let reason = status.pausedReason?.nilIfBlank {
                    banner("Paused: \(reason)", icon: "pause.circle.fill", tint: Theme.warning)
                }
            } else if !connection.isConnected {
                Text("Turn on Wi-Fi and Bluetooth on both; no network needed. Flambient must be running on the Mac.")
                    .font(.footnote)
                    .foregroundStyle(Theme.secondaryText)
                if !nearbyMacs.isEmpty, connection.macName == nil {
                    Text("Nearby: \(nearbyMacs.joined(separator: ", "))")
                        .font(.footnote)
                        .foregroundStyle(Theme.tertiaryText)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card(padding: 16)
    }

    private func banner(_ text: String, icon: String, tint: Color) -> some View {
        Label(text, systemImage: icon)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(tint)
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private var stateLabel: String { Self.label(connection) }
    private var tint: Color { Self.tint(connection) }
    private var icon: String {
        switch connection {
        case .connected: "laptopcomputer"
        case .needsPairing: "lock.fill"
        case .failed: "exclamationmark.triangle.fill"
        default: "antenna.radiowaves.left.and.right"
        }
    }

    static func label(_ connection: FlambientLink.Connection) -> String {
        switch connection {
        case .idle: "Not running"
        case .browsing: "Searching for Mac…"
        case .connecting: "Connecting…"
        case .connected: "Connected"
        case .needsPairing: "Needs pairing"
        case .failed: "Connection failed, retrying"
        }
    }

    static func tint(_ connection: FlambientLink.Connection) -> Color {
        switch connection {
        case .connected: Theme.emerald
        case .needsPairing: Theme.amber
        case .failed: Theme.danger
        default: Theme.sky
        }
    }

    static func ago(_ date: Date, now: Date) -> String {
        let seconds = max(0, Int(now.timeIntervalSince(date)))
        if seconds < 60 { return "\(seconds)s ago" }
        if seconds < 3600 { return "\(seconds / 60)m ago" }
        return "\(seconds / 3600)h ago"
    }
}

// MARK: - Pairing

struct PairingCard: View {
    let mac: String
    let pair: (String, String) -> Void
    @State private var code = ""
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Pair with \(mac)")
                .font(.headline)
                .foregroundStyle(Theme.primaryText)
            Text("Enter the one-time code shown in Flambient's settings on the Mac.")
                .font(.footnote)
                .foregroundStyle(Theme.secondaryText)
            TextField("000000", text: $code)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                .font(.system(size: 34, weight: .bold, design: .monospaced))
                .multilineTextAlignment(.center)
                .focused($focused)
                .padding(.vertical, 10)
                .background(Theme.cardRaised, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .onChange(of: code) { _, new in
                    let digits = String(new.filter(\.isNumber).prefix(6))
                    if digits != new { code = digits }
                }
            Button {
                pair(mac, code)
                focused = false
            } label: {
                Text("Pair")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.accent)
            .foregroundStyle(.black)
            .disabled(code.count != 6)
        }
        .card(padding: 16)
    }
}

// MARK: - Import sheet

struct FlambientImportSheet: View {
    @Environment(\.dismiss) private var dismiss
    let session: RemoteSession
    let bookings: [Booking]
    let onImport: (String, String?) -> Void

    @State private var address = ""
    @State private var bookingId: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Address", text: $address)
                        .textInputAutocapitalization(.words)
                        .font(.body.weight(.medium))
                } header: {
                    Text(FlambientDashboard.timeRange(session) + " · " + FlambientDashboard.counts(session))
                }
                if !bookings.isEmpty {
                    Section("Bookings that day") {
                        ForEach(bookings) { booking in
                            Button {
                                bookingId = booking.id
                                address = FlambientBookingMatch.shootName(for: booking)
                            } label: {
                                HStack {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(FlambientBookingMatch.shootName(for: booking))
                                            .foregroundStyle(Theme.primaryText)
                                        if let at = DateFormatting.parse(booking.jobDate) {
                                            Text(at.formatted(date: .omitted, time: .shortened))
                                                .font(.caption)
                                                .foregroundStyle(Theme.secondaryText)
                                        }
                                    }
                                    Spacer()
                                    if bookingId == booking.id {
                                        Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.accent)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .navigationTitle("Import")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Import") {
                        onImport(address.trimmingCharacters(in: .whitespacesAndNewlines), bookingId)
                        dismiss()
                    }
                    .fontWeight(.semibold)
                    .disabled(address.nilIfBlank == nil)
                }
            }
            .onAppear(perform: prefill)
        }
    }

    private func prefill() {
        guard address.isEmpty else { return }
        if let id = session.suggestedBookingId, let match = bookings.first(where: { $0.id == id }) {
            bookingId = match.id
            address = FlambientBookingMatch.shootName(for: match)
        } else if let best = bookings.first {
            bookingId = best.id
            address = FlambientBookingMatch.shootName(for: best)
        } else {
            bookingId = session.suggestedBookingId
            address = session.suggestedAddress ?? ""
        }
    }
}

// MARK: - Shoot detail

struct FlambientShootDetailView: View {
    let route: FlambientShootRoute
    let shoot: RemoteShoot?
    let detail: RemoteShootDetail?
    let actions: FlambientActions

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: 10)]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let shoot {
                    HStack {
                        BadgeChip(text: shoot.stage.capitalized, tint: shoot.planned ? Theme.emerald : Theme.slate)
                        Text("\(shoot.photos) photos")
                            .font(.subheadline)
                            .foregroundStyle(Theme.secondaryText)
                        Spacer()
                    }
                    if !shoot.planned {
                        Button {
                            actions.planShoot(route.path)
                        } label: {
                            Label("Plan angles", systemImage: "square.grid.3x3.fill")
                                .font(.headline)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 6)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(Theme.accent)
                        .foregroundStyle(.black)
                    }
                }
                if let detail {
                    if detail.angles.isEmpty {
                        EmptyStateView(icon: "photo.on.rectangle", title: "No angles yet", message: "Plan the shoot to group its brackets into angles.")
                    } else {
                        LazyVGrid(columns: columns, spacing: 10) {
                            ForEach(detail.angles) { AngleTile(angle: $0) }
                        }
                    }
                } else {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
                }
            }
            .padding(16)
        }
        .background(Theme.background)
        .navigationTitle(route.name)
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { actions.requestShootDetail(route.path) }
        .onAppear { actions.requestShootDetail(route.path) }
        .onChange(of: shoot?.planned) { _, _ in actions.requestShootDetail(route.path) }
    }
}

private struct AngleTile: View {
    let angle: RemoteAngle

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ZStack(alignment: .topTrailing) {
                Group {
                    if let data = angle.thumbnail, let image = UIImage(data: data) {
                        Image(uiImage: image).resizable().scaledToFill()
                    } else {
                        Theme.cardRaised.overlay(Image(systemName: "photo").foregroundStyle(Theme.tertiaryText))
                    }
                }
                .frame(maxWidth: .infinity)
                .aspectRatio(3 / 2, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                if angle.isHDR {
                    BadgeChip(text: "HDR", tint: Theme.amber, filled: true).padding(6)
                }
            }
            Text("\(angle.frames) frames · \(angle.flashes) flash")
                .font(.caption)
                .foregroundStyle(Theme.secondaryText)
            if !angle.flags.isEmpty {
                Text(angle.flags.joined(separator: " · "))
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(Theme.warning)
                    .lineLimit(2)
            }
        }
        .card(padding: 8)
    }
}

// MARK: - Card session previews

/// A card session at a glance: its first photo, an arrow, its last photo, so the span of the shoot
/// reads before importing. Tapping it opens the full preview.
struct FlambientSessionSpan: View {
    let preview: RemoteSessionPreview?
    let photoCount: Int

    var body: some View {
        let first = preview?.frames.first
        let last = (preview?.frames.count ?? 0) > 1 ? preview?.frames.last : nil
        HStack(spacing: 8) {
            FlambientCardThumb(frame: first, loading: preview == nil, caption: first.flatMap(Self.time))
            if photoCount > 1 || preview == nil {
                Image(systemName: "arrow.right")
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(Theme.tertiaryText)
                FlambientCardThumb(frame: last, loading: preview == nil, caption: last.flatMap(Self.time))
            } else {
                Color.clear.aspectRatio(3 / 2, contentMode: .fit).frame(maxWidth: .infinity)
            }
            Image(systemName: "chevron.right")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Theme.tertiaryText)
        }
    }

    static func time(_ frame: RemoteCardFrame) -> String? {
        frame.date?.formatted(date: .omitted, time: .shortened)
    }
}

/// One photo on a card, 3:2, with an optional caption chip in the corner.
struct FlambientCardThumb: View {
    let frame: RemoteCardFrame?
    var loading = false
    var caption: String?
    var cornerRadius: CGFloat = 8

    var body: some View {
        Theme.cardRaised
            .aspectRatio(3 / 2, contentMode: .fit)
            .frame(maxWidth: .infinity)
            .overlay {
                if let data = frame?.thumbnail, let image = UIImage(data: data) {
                    Image(uiImage: image).resizable().scaledToFill()
                } else if loading {
                    ProgressView().controlSize(.small)
                } else {
                    Image(systemName: frame?.kind == "video" ? "video.fill" : "photo")
                        .foregroundStyle(Theme.tertiaryText)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .overlay(alignment: .bottomLeading) {
                if let caption {
                    Text(caption)
                        .font(.caption2.weight(.semibold).monospacedDigit())
                        .foregroundStyle(.white)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(.black.opacity(0.55), in: Capsule())
                        .padding(5)
                }
            }
    }
}

/// What's in a session on the card: an even spread of its photos from first to last, any of which
/// opens full screen, and the Import button.
struct FlambientCardSessionView: View {
    @Environment(AppState.self) private var appState
    let route: FlambientCardSessionRoute
    let session: RemoteSession?
    let preview: RemoteSessionPreview?
    let cardPhotos: [String: Data]
    let actions: FlambientActions

    @State private var showImport = false
    @State private var viewing: RemoteCardFrame?

    /// Enough to see every room of a typical house without a slow send over Bluetooth.
    static let gridLimit = 48
    private let columns = [GridItem(.adaptive(minimum: 104), spacing: 6)]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let session {
                    header(session)
                    if let preview {
                        if preview.frames.isEmpty {
                            EmptyStateView(icon: "photo.on.rectangle", title: "No photos", message: "This session has nothing to preview.")
                        } else {
                            if preview.frames.count < preview.photoCount {
                                Text("\(preview.frames.count) of \(preview.photoCount) photos, spread from first to last")
                                    .font(.caption)
                                    .foregroundStyle(Theme.secondaryText)
                            }
                            LazyVGrid(columns: columns, spacing: 6) {
                                ForEach(preview.frames) { frame in
                                    Button { viewing = frame } label: {
                                        FlambientCardThumb(frame: frame, caption: "\(frame.index + 1)", cornerRadius: 6)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                    } else {
                        ProgressView("Reading the card…")
                            .frame(maxWidth: .infinity)
                            .padding(.top, 40)
                    }
                } else {
                    EmptyStateView(icon: "sdcard", title: "Card removed", message: "This session isn't on a connected card any more.")
                }
            }
            .padding(16)
        }
        .background(Theme.background)
        .navigationTitle(session.map { $0.start.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day()) } ?? "Card")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { actions.requestSessionPreview(route.cardID, route.sessionID, Self.gridLimit) }
        .sheet(isPresented: $showImport) {
            if let session {
                FlambientImportSheet(
                    session: session,
                    bookings: appState.bookings.value.map { FlambientBookingMatch.candidates(for: session, in: $0) } ?? []
                ) { address, bookingId in
                    actions.importSession(route.cardID, session.id, address, bookingId)
                }
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
            }
        }
        .fullScreenCover(item: $viewing) { start in
            FlambientCardPhotoPager(
                frames: preview?.frames ?? [start],
                photoCount: preview?.photoCount ?? 1,
                photos: cardPhotos,
                start: start.id
            ) { actions.requestCardPhoto(route.cardID, $0) }
        }
    }

    private func header(_ session: RemoteSession) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(FlambientDashboard.timeRange(session))
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Theme.primaryText)
                Text(FlambientDashboard.counts(session))
                    .font(.caption)
                    .foregroundStyle(Theme.secondaryText)
                if let imported = session.importedAs {
                    Text("Imported as \(imported)")
                        .font(.caption)
                        .foregroundStyle(Theme.tertiaryText)
                } else if let suggested = session.suggestedAddress {
                    Text(suggested)
                        .font(.caption)
                        .foregroundStyle(Theme.secondaryText)
                }
            }
            FlambientSessionSpan(preview: preview, photoCount: session.photos)
            if session.importedAs == nil {
                Button {
                    showImport = true
                } label: {
                    Label("Import", systemImage: "square.and.arrow.down")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.accent)
                .foregroundStyle(.black)
            }
        }
        .card(padding: 14)
    }
}

/// Card photos full screen, swiped through. Each page shows its thumbnail at once and swaps in the
/// screen-size JPEG when the Mac sends it.
struct FlambientCardPhotoPager: View {
    @Environment(\.dismiss) private var dismiss
    let frames: [RemoteCardFrame]
    let photoCount: Int
    let photos: [String: Data]
    let request: (String) -> Void
    @State private var selection: String

    init(frames: [RemoteCardFrame], photoCount: Int, photos: [String: Data], start: String,
         request: @escaping (String) -> Void) {
        self.frames = frames
        self.photoCount = photoCount
        self.photos = photos
        self.request = request
        _selection = State(initialValue: start)
    }

    var body: some View {
        ZStack(alignment: .top) {
            Color.black.ignoresSafeArea()
            TabView(selection: $selection) {
                ForEach(frames) { frame in
                    page(frame).tag(frame.id)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .ignoresSafeArea()
            topBar
        }
        .statusBarHidden()
        .onChange(of: selection, initial: true) { _, id in
            request(id)
            // The next one too, so a swipe forward rarely waits.
            if let i = frames.firstIndex(where: { $0.id == id }), i + 1 < frames.count {
                request(frames[i + 1].id)
            }
        }
    }

    private var current: RemoteCardFrame? { frames.first { $0.id == selection } }

    private var topBar: some View {
        HStack(alignment: .top) {
            if let current {
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(current.index + 1) of \(photoCount)")
                        .font(.headline.monospacedDigit())
                    Text([current.name, current.date?.formatted(date: .omitted, time: .standard)]
                        .compactMap { $0 }.joined(separator: " · "))
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.7))
                }
                .foregroundStyle(.white)
            }
            Spacer()
            Button { dismiss() } label: {
                Image(systemName: "xmark")
                    .font(.headline)
                    .foregroundStyle(.white)
                    .frame(width: 36, height: 36)
                    .background(.white.opacity(0.15), in: Circle())
            }
            .accessibilityLabel("Close")
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .background(LinearGradient(colors: [.black.opacity(0.6), .clear], startPoint: .top, endPoint: .bottom)
            .ignoresSafeArea())
    }

    @ViewBuilder private func page(_ frame: RemoteCardFrame) -> some View {
        let full = photos[frame.id]
        ZStack {
            if let data = full ?? frame.thumbnail, let image = UIImage(data: data) {
                Image(uiImage: image).resizable().scaledToFit()
            } else {
                Image(systemName: frame.kind == "video" ? "video.fill" : "photo")
                    .font(.largeTitle)
                    .foregroundStyle(.white.opacity(0.4))
            }
            if full == nil, frame.kind != "video" {
                ProgressView().tint(.white)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Home card

/// The Home tab's at-a-glance Flambient line: connection and current import.
struct FlambientHomeCard: View {
    @State private var link = FlambientLink.shared

    var body: some View {
        NavigationLink(value: FlambientRoute()) {
            HStack(spacing: 12) {
                Image(systemName: link.connection.isConnected ? "laptopcomputer" : "antenna.radiowaves.left.and.right")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(FlambientHeader.tint(link.connection))
                    .frame(width: 36, height: 36)
                    .background(FlambientHeader.tint(link.connection).opacity(0.15), in: Circle())
                VStack(alignment: .leading, spacing: 4) {
                    Text(link.status?.macName ?? link.connection.macName ?? "Flambient")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(Theme.primaryText)
                        .lineLimit(1)
                    if let active = link.status?.imports.first(where: { FlambientDashboard.isActive($0.state) }) {
                        Text("\(active.state.capitalized) \(active.shootName)")
                            .font(.caption)
                            .foregroundStyle(Theme.secondaryText)
                            .lineLimit(1)
                        ProgressView(value: min(max(active.progress, 0), 1))
                            .tint(FlambientDashboard.importTint(active.state))
                    } else {
                        Text(subtitle)
                            .font(.caption)
                            .foregroundStyle(FlambientHeader.tint(link.connection))
                    }
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.tertiaryText)
            }
            .card(padding: 14)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var subtitle: String {
        guard link.connection.isConnected, let status = link.status else {
            return FlambientHeader.label(link.connection)
        }
        let sessions = status.cards.flatMap(\.sessions).filter { $0.importedAs == nil }.count
        return sessions > 0 ? "Connected · \(sessions) session\(sessions == 1 ? "" : "s") to import" : "Connected"
    }
}

struct FlambientRoute: Hashable {}

// MARK: - Preview

#Preview("Flambient") {
    let now = Date()
    let status = RemoteStatus(
        macName: "Lukas's MacBook Pro",
        sent: now,
        battery: 0.64,
        charging: false,
        thermal: "serious",
        stayingAwake: true,
        stayAwakeReady: true,
        autoImport: false,
        pausedReason: nil,
        cards: [RemoteCard(id: "card1", name: "EOS_DIGITAL", isScanning: false, sessions: [
            RemoteSession(id: now.addingTimeInterval(-7200), start: now.addingTimeInterval(-7200), end: now.addingTimeInterval(-4000),
                          photos: 412, videos: 2, importedAs: nil, suggestedAddress: "1234 Maple Ave", suggestedBookingId: nil),
            RemoteSession(id: now.addingTimeInterval(-90000), start: now.addingTimeInterval(-90000), end: now.addingTimeInterval(-86000),
                          photos: 288, videos: 0, importedAs: "88 Oak St", suggestedAddress: nil, suggestedBookingId: nil),
        ])],
        imports: [RemoteImport(id: "i1", shootName: "88 Oak St", state: "importing", progress: 0.42, detail: "121 of 288 files")],
        shoots: [
            RemoteShoot(id: "/shoots/88 Oak St", name: "88 Oak St", date: now, stage: "imported", angles: nil, photos: 288, planned: false),
            RemoteShoot(id: "/shoots/5 Elm Ct", name: "5 Elm Ct", date: now.addingTimeInterval(-86400 * 3), stage: "planned", angles: 34, photos: 356, planned: true),
        ]
    )
    return NavigationStack {
        FlambientDashboard(
            connection: .connected("Lukas's MacBook Pro"),
            status: status,
            lastStatusAt: now.addingTimeInterval(-4),
            lastError: nil,
            nearbyMacs: [],
            shootDetails: ["/shoots/5 Elm Ct": RemoteShootDetail(path: "/shoots/5 Elm Ct", name: "5 Elm Ct", angles: (0..<6).map {
                RemoteAngle(id: "a\($0)", thumbnail: nil, frames: 5, flashes: $0 % 3, isHDR: $0 == 2, flags: $0 == 4 ? ["Person in frame"] : [])
            })],
            actions: FlambientActions()
        )
    }
    .environment(AppState())
    .preferredColorScheme(.dark)
}

#Preview("Card session") {
    let now = Date()
    let session = RemoteSession(id: now, start: now, end: now.addingTimeInterval(3600), photos: 412, videos: 2,
                                importedAs: nil, suggestedAddress: "1234 Maple Ave", suggestedBookingId: nil)
    let frames = (0..<12).map {
        RemoteCardFrame(id: "/card/P\($0).RW2", name: "P\($0).RW2", date: now.addingTimeInterval(Double($0) * 300),
                        kind: "camera", index: $0 * 37, thumbnail: nil)
    }
    return NavigationStack {
        FlambientCardSessionView(
            route: FlambientCardSessionRoute(cardID: "card1", sessionID: now),
            session: session,
            preview: RemoteSessionPreview(cardID: "card1", sessionID: now, photoCount: 412, frames: frames),
            cardPhotos: [:],
            actions: FlambientActions()
        )
    }
    .environment(AppState())
    .preferredColorScheme(.dark)
}

#Preview("Pairing") {
    NavigationStack {
        FlambientDashboard(connection: .needsPairing("Studio Mac"), status: nil, lastStatusAt: nil, lastError: nil,
                           nearbyMacs: ["Studio Mac"], shootDetails: [:], actions: FlambientActions())
    }
    .environment(AppState())
    .preferredColorScheme(.dark)
}

#endif
