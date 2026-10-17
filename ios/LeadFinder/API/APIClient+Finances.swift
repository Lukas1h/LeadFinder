import Foundation

// The Finances endpoints (docs/ios-backend-spec.md, "Finances"). The reads
// that back a screen are `Resource`s in AppState; these are the writes and the
// one-off reads behind a form.

extension APIClient {
    // MARK: - Expenses

    /// Every field of the expense form. Nil is sent as null, so an edit can
    /// clear a vendor or unlink a job (a PATCH leaves out only what it omits).
    struct ExpenseInput: Encodable, Sendable {
        var date: String
        var amount: Double
        var description: String
        var category: String
        var vendor: String?
        var deductiblePercent: Int
        var gallons: Double?
        var pricePerGallon: Double?
        var paidPersonally: Bool
        var spreadMonths: Int
        var bookingId: String?
        var tripId: String?
        var notes: String?

        private enum CodingKeys: String, CodingKey {
            case date, amount, description, category, vendor, deductiblePercent, gallons, pricePerGallon
            case paidPersonally, spreadMonths, bookingId, tripId, notes
        }

        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(date, forKey: .date)
            try c.encode(amount, forKey: .amount)
            try c.encode(description, forKey: .description)
            try c.encode(category, forKey: .category)
            try c.encode(vendor, forKey: .vendor)
            try c.encode(deductiblePercent, forKey: .deductiblePercent)
            try c.encode(gallons, forKey: .gallons)
            try c.encode(pricePerGallon, forKey: .pricePerGallon)
            try c.encode(paidPersonally, forKey: .paidPersonally)
            try c.encode(spreadMonths, forKey: .spreadMonths)
            try c.encode(bookingId, forKey: .bookingId)
            try c.encode(tripId, forKey: .tripId)
            try c.encode(notes, forKey: .notes)
        }
    }

    private struct ExpenseResult: Decodable, Sendable { let expense: Expense }
    private struct OK: Decodable, Sendable { let ok: Bool }
    private struct Empty: Encodable, Sendable {}

    func createExpense(_ input: ExpenseInput) async throws -> Expense {
        try await send("POST", "api/app/v1/finances/expenses", body: input, as: ExpenseResult.self).expense
    }

    func updateExpense(id: String, _ input: ExpenseInput) async throws -> Expense {
        try await send("PATCH", "api/app/v1/finances/expenses/\(id)", body: input, as: ExpenseResult.self).expense
    }

    /// Deletes its receipt too.
    func deleteExpense(id: String) async throws {
        _ = try await send("DELETE", "api/app/v1/finances/expenses/\(id)", body: Empty?.none, as: OK.self)
    }

    /// Attaches (or replaces) the receipt. `data` is a JPEG already shrunk to
    /// ~1800px, or a PDF: Vercel rejects bodies over 4.5 MB. Returns the
    /// receipt number the expense got.
    @discardableResult
    func uploadReceipt(expenseId: String, data: Data, contentType: String, filename: String?) async throws -> Int? {
        struct Result: Decodable, Sendable { let receiptNumber: Int? }
        let query = filename.map { [URLQueryItem(name: "name", value: $0)] } ?? []
        var request = try await authorizedRequest("api/app/v1/finances/expenses/\(expenseId)/receipt", query: query)
        request.httpMethod = "PUT"
        request.httpBody = data
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        let bytes = try await checked(request)
        return try? decoder.decode(Result.self, from: bytes).receiptNumber
    }

    /// The receipt file. Bearer auth like every route, so it can't be a plain URL.
    func receiptData(expenseId: String) async throws -> (data: Data, contentType: String?) {
        var request = try await authorizedRequest("api/app/v1/finances/expenses/\(expenseId)/receipt")
        request.setValue("*/*", forHTTPHeaderField: "Accept")
        let (data, response) = try await send(request)
        guard let http = response as? HTTPURLResponse else { throw APIError.http(-1, "No response") }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else { throw APIError.http(http.statusCode, nil) }
        return (data, http.value(forHTTPHeaderField: "Content-Type"))
    }

    /// Gemini reads the receipt. Saves nothing; the form is prefilled from it.
    func readReceipt(data: Data, contentType: String) async throws -> ReceiptReading {
        var request = try await authorizedRequest("api/app/v1/finances/receipts/read")
        request.httpMethod = "POST"
        request.httpBody = data
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        // Gemini can take a while on a long receipt.
        request.timeoutInterval = 60
        let bytes = try await checked(request)
        do {
            return try decoder.decode(ReceiptReading.self, from: bytes)
        } catch {
            throw APIError.decoding(String(describing: error))
        }
    }

    // MARK: - Trips

    struct TripInput: Encodable, Sendable {
        var date: String
        var purpose: String
        var category: String
        var miles: Double
        var stops: String?
        var driveMinutes: Double?
        var milesEstimated: Bool
        var notes: String?
        var bookingIds: [String]

        private enum CodingKeys: String, CodingKey {
            case date, purpose, category, miles, stops, driveMinutes, milesEstimated, notes, bookingIds
        }

        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(date, forKey: .date)
            try c.encode(purpose, forKey: .purpose)
            try c.encode(category, forKey: .category)
            try c.encode(miles, forKey: .miles)
            try c.encode(stops, forKey: .stops)
            try c.encode(driveMinutes, forKey: .driveMinutes)
            try c.encode(milesEstimated, forKey: .milesEstimated)
            try c.encode(notes, forKey: .notes)
            try c.encode(bookingIds, forKey: .bookingIds)
        }
    }

    func createTrip(_ input: TripInput) async throws {
        _ = try await send("POST", "api/app/v1/finances/trips", body: input, as: OK.self)
    }

    func updateTrip(id: String, _ input: TripInput) async throws {
        _ = try await send("PATCH", "api/app/v1/finances/trips/\(id)", body: input, as: OK.self)
    }

    func deleteTrip(id: String) async throws {
        _ = try await send("DELETE", "api/app/v1/finances/trips/\(id)", body: Empty?.none, as: OK.self)
    }

    /// The second job of a two-job day: same drive, so it joins the trip.
    func addBookingToTrip(tripId: String, bookingId: String) async throws {
        struct Body: Encodable, Sendable { let bookingId: String }
        _ = try await send("POST", "api/app/v1/finances/trips/\(tripId)/bookings", body: Body(bookingId: bookingId), as: OK.self)
    }

    /// Round trip from home through the stops. Takes a few seconds; saves nothing.
    func estimateRoute(stops: [String]) async throws -> RouteEstimate {
        struct Body: Encodable, Sendable { let stops: [String] }
        return try await send("POST", "api/app/v1/finances/trips/estimate", body: Body(stops: stops), as: RouteEstimate.self)
    }

    // MARK: - Settings and pickers

    func updateFinanceSettings(mpg: Double?, otherWagesMonthly: Double?) async throws {
        struct Body: Encodable, Sendable {
            let mpg: Double?
            let otherWagesMonthly: Double?
        }
        _ = try await send("PATCH", "api/app/v1/finances/settings", body: Body(mpg: mpg, otherWagesMonthly: otherWagesMonthly), as: OK.self)
    }

    /// The jobs, trips and categories the expense and trip forms pick from.
    func financeLinkOptions() async throws -> FinanceLinkOptions {
        try await read("api/app/v1/finances/link-options")
    }
}
