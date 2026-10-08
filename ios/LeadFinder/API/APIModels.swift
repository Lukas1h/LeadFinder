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
