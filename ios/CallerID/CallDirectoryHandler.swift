import CallKit
import Foundation

/// Labels incoming calls from agents: "Jane Doe · Client".
///
/// iOS runs this when the app asks it to reload, never on an incoming call —
/// it hands the OS the whole table once, and the OS matches calls against it
/// itself. So this downloads `/caller-id` (already sorted ascending, one entry
/// per number, as iOS requires) and adds every entry, replacing the last set.
/// It fetches for itself rather than reading the app's cache, so it doesn't
/// need an App Group, which a free account may not provision.
final class CallDirectoryHandler: CXCallDirectoryProvider {
    override func beginRequest(with context: CXCallDirectoryExtensionContext) {
        let box = ContextBox(context)
        Task {
            do {
                let table = try await CallerIDTable.download()
                let context = box.context
                if context.isIncremental { context.removeAllIdentificationEntries() }
                for (number, label) in table.entries {
                    context.addIdentificationEntry(withNextSequentialPhoneNumber: number, label: label)
                }
                _ = await context.completeRequest()
            } catch {
                box.context.cancelRequest(withError: error)
            }
        }
    }
}

/// The context isn't Sendable; iOS only touches it from our calls.
private final class ContextBox: @unchecked Sendable {
    let context: CXCallDirectoryExtensionContext
    init(_ context: CXCallDirectoryExtensionContext) { self.context = context }
}
