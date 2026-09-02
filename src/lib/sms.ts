export function firstName(fullName: string | null): string | null {
  if (!fullName) return null;
  return fullName.trim().split(/\s+/)[0] || null;
}

export function smsUrl(phone: string, message: string): string | null {
  const digits = phone.replace(/\D/g, "");
  let target: string;
  if (digits.length === 10) target = `+1${digits}`;
  else if (digits.length === 11 && digits.startsWith("1")) target = `+${digits}`;
  else return null;

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const separator = isIOS ? "&" : "?";
  return `sms:${target}${separator}body=${encodeURIComponent(message)}`;
}

export function initialOutreachMessage(agentName: string | null, address: string | null): string {
  const name = firstName(agentName);
  return `Hi${name ? ` ${name}` : ""}, I'm a local real estate photographer and saw you just listed ${
    address ?? "your property"
  }. Let me know if you're looking for photos!`;
}

export function followUpMessage(agentName: string | null, address: string | null): string {
  const name = firstName(agentName);
  return `Hi${name ? ` ${name}` : ""}, just following up on ${
    address ?? "the property"
  } — let me know if you're still looking for a photographer!`;
}
