import Foundation

// Wire types for /api/app/v1. They mirror `src/app/api/app/v1/serialize.ts` on
// the server. Phase 2 is read-only, so this covers the GET responses only;
// the write payloads in the spec come with Phase 3.
//
// Everything here is a plain Sendable struct of value types, so decoding a
// 2.5 MB /agents payload off the main actor is safe.

// MARK: - Shared

struct Agent: Codable, Sendable, Identifiable, Hashable {
    var id: String
    var name: String?
    var phone: String?
    var email: String?
    var relationshipStatus: String?
    var lastContactedAt: String?
    var notes: String?
    var createdAt: String?

    var displayName: String { name?.nilIfBlank ?? "Unknown agent" }
}

struct Listing: Codable, Sendable, Identifiable, Hashable {
    var id: String
    var zpid: String?
    var address: String?
    var city: String?
    var state: String?
    var zipcode: String?
    var price: Int?
    var livingArea: Int?
    var homeType: String?
    var listingUrl: String?
    var listedAt: String?
    var foundAt: String?
    var photoCount: Int?
    var isComingSoon: Bool?
    var has3dTour: Bool?
    var priceCutAt: String?
    var priceCutAmount: Int?
    var priceCutCount: Int?
    var originalPrice: Int?
    var resurfacedAt: String?
    var brokerName: String?
    var agentName: String?
    var agentPhone: String?
    var agentId: String?
    var status: String?
    var contactedAt: String?
    var statusChangedAt: String?
    var bookingId: String?
    var followUpAt: String?
    var followUpNote: String?
    var leadSection: String?
    var score: Int?
    var scoreReasoning: String?
    var notes: String?
    var sourceLabel: String?
    var realtorUrl: String?
    var redfinUrl: String?
    var bedrooms: Double?
    var bathrooms: Double?
    /// First photo on list endpoints, all of them on detail endpoints.
    var photos: [String]?

    var addressLine: String {
        [address, city].compactMap { $0?.nilIfBlank }.joined(separator: ", ")
    }

    var priceLine: String {
        guard let price else { return "Price unknown" }
        return "$" + price.formatted(.number.grouping(.automatic))
    }

    /// Home type is stored SCREAMING_SNAKE, which reads badly on a phone.
    var homeTypeLabel: String? {
        guard let homeType else { return nil }
        return homeType.split(separator: "_")
            .map { $0.capitalized }
            .joined(separator: " ")
    }
}

struct LeadBadge: Codable, Sendable, Hashable {
    var kind: String
    var label: String
    var detail: String?
}

// MARK: - GET /leads

struct LeadsResponse: Codable, Sendable {
    struct Counts: Codable, Sendable {
        var agents: Int
        var listings: Int
        var queued: Int
    }

    struct Group: Codable, Sendable, Identifiable, Hashable {
        var key: String
        var agent: Agent?
        var agentName: String?
        var agentPhone: String?
        var brokerName: String?
        var contactLine: String?
        var knownGroup: String?
        var section: String
        var best: Listing
        var badges: [LeadBadge]
        var others: [Listing]
        /// Every listing in the group, so Pass covers the whole group as on the web.
        var listingIds: [String]

        var id: String { key }
    }

    struct Section: Codable, Sendable, Identifiable {
        var key: String
        var label: String
        var collapsed: Bool
        var groups: [Group]

        var id: String { key }
    }

    var counts: Counts
    var sections: [Section]
}

// MARK: - GET /follow-up

struct FollowUpResponse: Codable, Sendable {
    struct Entry: Codable, Sendable, Identifiable {
        var agent: Agent
        var lastReplyAt: String?

        var id: String { agent.id }
    }

    struct Group: Codable, Sendable, Identifiable {
        var label: String
        var entries: [Entry]

        var id: String { label }
    }

    /// Just-listed agents, each with the listing that brought them back.
    struct JustListed: Codable, Sendable, Identifiable {
        var agent: Agent
        var lastReplyAt: String?
        var listing: Listing?

        var id: String { agent.id }
    }

    var justListed: [JustListed]
    var groups: [Group]
}

// MARK: - GET /schedule

struct ScheduleResponse: Codable, Sendable {
    /// Reminders and listing follow-ups, the same items as the web Schedule.
    struct Item: Codable, Sendable, Identifiable {
        var key: String
        var kind: String
        var date: String
        var time: String?
        var durationMinutes: Int?
        var title: String
        var subtitle: String?
        var notes: String?
        var agent: Agent?
        var href: String?
        var bookingId: String?
        var done: Bool
        var reminderId: String?
        var listingId: String?
        var listing: Listing?

        var id: String { key }
    }

    var today: String
    var items: [Item]
}

// MARK: - GET /bookings

struct BookingsResponse: Codable, Sendable {
    var upcoming: [Booking]
    var waitingForPayment: [Booking]
    var completed: [Booking]
}

struct Booking: Codable, Sendable, Identifiable, Hashable {
    struct LineItem: Codable, Sendable, Hashable {
        var description: String
        var amount: Int
    }

    var id: String
    var listingId: String?
    var contactAgentId: String?
    var address: String?
    var city: String?
    var state: String?
    var listing: Listing?
    var jobDate: String?
    var lockboxCode: String?
    var notes: String?
    var invoiceNote: String?
    var completedAt: String?
    var invoiceSentAt: String?
    var driveHours: Double?
    var editingHours: Double?
    var shootingHours: Double?
    var logisticsHours: Double?
    var additionalCosts: Int?
    var createdAt: String
    var contactName: String?
    var contactPhone: String?
    var lineItems: [LineItem]
    var total: Int
    var driveTime: String?
    var invoiceNumber: Int?
    var invoicedAt: String?
    var dropboxFolderLink: String?
    var galleryUrl: String?
    var mapsQuery: String?

    var addressLine: String {
        [address, city, state].compactMap { $0?.nilIfBlank }.joined(separator: ", ")
    }
}

// MARK: - GET /agents

struct AgentsResponse: Codable, Sendable {
    struct Row: Codable, Sendable, Identifiable, Hashable {
        var id: String
        var name: String?
        var phone: String?
        var email: String?
        var relationshipStatus: String?
        var lastContactedAt: String?
        var brokerage: String?
        /// E.164 as a JS number, e.g. 15415551234. Null when the phone isn't
        /// ten digits after stripping a leading 1.
        var callerNumber: Int?
        var callerLabel: String?

        var displayName: String { name?.nilIfBlank ?? "Unknown agent" }
    }

    var agents: [Row]
}
// MARK: - GET /listings/:id

struct ListingDetailResponse: Codable, Sendable {
    /// `photos` is the full set here ("all"), unlike the lead cards' sample.
    var listing: Listing
    var agent: Agent?
}

// MARK: - GET /messages
//
// Mirrors the web's /messaging page (MessagingStatsCard + MessageHistoryCard).
// The wording is the web's; only the transport is ours.

struct MessagesResponse: Codable, Sendable {
    struct SendCounts: Codable, Sendable {
        /// All-time.
        var sent: Int
        /// The last 30 days. Computed server-side; not recomputed here.
        var sentRecent: Int
        var replied: Int
        var booked: Int
    }

    struct Template: Codable, Sendable, Identifiable, Hashable {
        var presetId: String
        var name: String
        var channel: String
        var type: String
        var sent: Int
        var replied: Int
        var booked: Int
        var archived: Bool

        var id: String { presetId }
    }

    /// One weekday's sends and replies, Monday first, zero-filled server-side.
    struct DayBucket: Codable, Sendable, Hashable {
        var label: String
        var sent: Int
        var replied: Int
    }

    struct ByDay: Codable, Sendable {
        var sms: [DayBucket]
        var email: [DayBucket]
    }

    struct Stats: Codable, Sendable {
        var sms: SendCounts
        var email: SendCounts
        var revenue: Double
        /// Already trimmed to the top three per channel, texts first, by the server.
        var templates: [Template]
        var byDay: ByDay
    }

    /// One row of the history list. The web's RecentSend.
    struct Send: Codable, Sendable, Identifiable, Hashable {
        var id: String
        var channel: String
        var type: String
        var presetName: String
        var sentAt: String
        var respondedAt: String?
        /// "pending" | "quoted" | "booked" | "declined"
        var result: String?
        var agentId: String?
        var agentName: String?
        var agentPhone: String?
        var agentEmail: String?
        var listingAddress: String?

        /// Who the message went to, in the web's fallback order.
        var recipient: String {
            agentName?.nilIfBlank
                ?? agentPhone?.nilIfBlank
                ?? agentEmail?.nilIfBlank
                ?? "Unknown recipient"
        }

        /// The web's RESULT_LABELS, with "Replied" standing in when a reply came
        /// back but no result was recorded. Returns nil when there's nothing to
        /// say. The colour lives with the view, so the model stays plain data.
        var outcomeLabel: String? {
            if let result, result != "pending" { return result.capitalized }
            if respondedAt != nil { return "Replied" }
            return nil
        }
    }

    var stats: Stats
    var sends: [Send]
}

// MARK: - GET /messages/:id

struct MessageDetailResponse: Codable, Sendable {
    /// The template as it reads for this agent and listing. Edits made at send
    /// time aren't stored, so this is re-rendered from the variant rather than
    /// the exact bytes that went out.
    var text: String
    var agent: Agent?
    var listing: Listing?
    /// Present when the preset has an email follow-up. The app shows it as
    /// information only — sending email stays on the web.
    var followUpEmail: FollowUpEmail?

    struct FollowUpEmail: Codable, Sendable, Hashable {
        var presetId: String
        var name: String
    }
}

// MARK: - GET /listings/:id/message-options, POST /listings/:id/ai-draft
//
// The web's PresetOption (src/app/messageActions.ts), same fields.

struct MessageOptionsResponse: Codable, Sendable {
    var presets: [MessageOption]
}

struct MessageOption: Codable, Sendable, Hashable {
    var presetId: String
    var presetName: String
    var variantId: String
    var variantLabel: String
    var text: String
    var recommended: Bool?
    /// The "Blank"/"type your own" preset, which the send dialogs default to
    /// over the recommended one.
    var blank: Bool?
    /// Copied to the clipboard on send so a second text can be pasted after.
    var secondMessage: String?
    var subject: String?

    /// The AI draft placeholder: variantId "draft" with empty text, filled in
    /// by POST /listings/:id/ai-draft.
    var aiDraft: Bool { variantId == "draft" }

    /// Identity for ForEach and for tracking the selection. variantId is only
    /// unique within a preset, so the pair is what distinguishes two options.
    var key: String { "\(presetId)::\(variantId)" }
}

// MARK: - GET /agents/:id

struct AgentDetailResponse: Codable, Sendable {
    struct Entry: Codable, Sendable, Identifiable {
        var kind: String
        var id: String
        var at: String?
        var presetName: String?
        var channel: String?
        var type: String?
        var respondedAt: String?
        var result: String?
        var listingAddress: String?
        var outcome: String?
        var note: String?
        var pending: Bool?
    }

    var agent: Agent
    var brokerage: String?
    /// Sends and logged interactions, newest first.
    var timeline: [Entry]
    var listings: [Listing]
    var bookings: [Booking]
}
