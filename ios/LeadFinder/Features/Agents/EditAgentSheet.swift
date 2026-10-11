import SwiftUI

/// The web's agent Edit form: name, phone, email, relationship, brokerage and
/// notes, plus delete. The server does the validation and says what's wrong.
struct EditAgentSheet: View {
    let agent: Agent
    /// Called after a save (`false`) or a delete (`true`).
    var onDone: (_ deleted: Bool) -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var name: String
    @State private var phone: String
    @State private var email: String
    @State private var status: String
    @State private var brokerage: String
    @State private var notes: String
    @State private var isSaving = false
    @State private var confirmDelete = false
    @State private var error: String?

    private static let statuses: [(value: String, label: String)] = [
        ("cold", "Cold"), ("warm", "Warm"), ("interested", "Interested"),
        ("worked_once", "Worked once"), ("regular", "Regular"), ("declined", "Declined"),
    ]

    init(agent: Agent, onDone: @escaping (Bool) -> Void) {
        self.agent = agent
        self.onDone = onDone
        _name = State(initialValue: agent.name ?? "")
        _phone = State(initialValue: agent.phone ?? "")
        _email = State(initialValue: agent.email ?? "")
        _status = State(initialValue: agent.relationshipStatus ?? "cold")
        _brokerage = State(initialValue: agent.brokerage ?? "")
        _notes = State(initialValue: agent.notes ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Contact") {
                    TextField("Name", text: $name)
                        .contentType(.name)
                    TextField("Phone", text: $phone)
                        .keyboard(.phone)
                        .contentType(.phone)
                    TextField("Email", text: $email)
                        .keyboard(.email)
                        .contentType(.email)
                        .autocapitalization(.never)
                        .autocorrectionDisabled()
                    TextField("Brokerage", text: $brokerage)
                }
                .listRowBackground(Theme.card)

                Section("Relationship") {
                    Picker("Status", selection: $status) {
                        ForEach(Self.statuses, id: \.value) { Text($0.label).tag($0.value) }
                    }
                }
                .listRowBackground(Theme.card)

                Section("Notes") {
                    TextField("Notes", text: $notes, axis: .vertical)
                        .lineLimit(3...)
                }
                .listRowBackground(Theme.card)

                if let error {
                    Section { Text(error).font(.caption).foregroundStyle(Theme.danger) }
                        .listRowBackground(Theme.card)
                }

                Section {
                    Button("Delete agent", role: .destructive) { confirmDelete = true }
                } footer: {
                    Text("Their bookings and past messages stay, just unlinked from them.")
                }
                .listRowBackground(Theme.card)
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .tint(Theme.accent)
            .navigationTitle("Edit agent")
            .titleDisplay(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }
                        .fontWeight(.semibold)
                        .disabled(isSaving)
                }
            }
            .confirmationDialog(
                "Delete \(agent.displayName)?",
                isPresented: $confirmDelete,
                titleVisibility: .visible
            ) {
                Button("Delete agent", role: .destructive) { Task { await delete() } }
                Button("Keep", role: .cancel) {}
            } message: {
                Text("This can't be undone.")
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .presentationBackground(Theme.background)
    }

    private func save() async {
        isSaving = true
        error = nil
        defer { isSaving = false }
        do {
            try await APIClient.shared.updateAgent(
                id: agent.id,
                APIClient.AgentEdit(
                    name: name,
                    phone: phone,
                    email: email,
                    relationshipStatus: status,
                    brokerage: brokerage,
                    notes: notes
                )
            )
            onDone(false)
            dismiss()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func delete() async {
        isSaving = true
        defer { isSaving = false }
        do {
            try await APIClient.shared.deleteAgent(id: agent.id)
            onDone(true)
            dismiss()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }
}
