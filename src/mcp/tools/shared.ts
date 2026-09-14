/** Shared by every MCP tool module — see src/mcp/tools.ts for the top-level registration. */
export function text(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

export function errorText(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeContact(
  phoneInput?: string,
  emailInput?: string
): { error?: string; phone: string | null; email: string | null } {
  const phone = phoneInput?.trim() || null;
  const email = emailInput?.trim().toLowerCase() || null;
  if (!phone && !email) return { error: "Provide a phone or an email", phone: null, email: null };
  if (phone && phone.replace(/\D/g, "").length < 10) return { error: "Invalid phone number", phone: null, email: null };
  if (email && !EMAIL_RE.test(email)) return { error: "Invalid email address", phone: null, email: null };
  return { phone, email };
}
