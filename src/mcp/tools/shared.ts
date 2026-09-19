import { normalizePhone, normalizeEmail, EMAIL_RE, hasValidPhoneDigitCount } from "@/lib/normalize";

/** Shared by every MCP tool module — see src/mcp/tools.ts for the top-level registration. */
export function text(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

export function errorText(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

export { EMAIL_RE };

export function normalizeContact(
  phoneInput?: string,
  emailInput?: string
): { error?: string; phone: string | null; email: string | null } {
  const phone = phoneInput?.trim() ? normalizePhone(phoneInput) : null;
  const email = emailInput?.trim() ? normalizeEmail(emailInput) : null;
  if (!phone && !email) return { error: "Provide a phone or an email", phone: null, email: null };
  if (phone && !hasValidPhoneDigitCount(phone)) return { error: "Invalid phone number", phone: null, email: null };
  if (email && !EMAIL_RE.test(email)) return { error: "Invalid email address", phone: null, email: null };
  return { phone, email };
}
