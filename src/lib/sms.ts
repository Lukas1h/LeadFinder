export function firstName(fullName: string | null): string | null {
  if (!fullName) return null;
  return fullName.trim().split(/\s+/)[0] || null;
}

const STREET_SUFFIXES = new Set([
  "ave", "avenue", "st", "street", "ln", "lane", "rd", "road", "dr", "drive",
  "blvd", "boulevard", "ct", "court", "pl", "place", "way", "cir", "circle",
  "ter", "terrace", "pkwy", "parkway", "trl", "trail", "loop", "hwy", "highway",
]);

const DIRECTIONALS = new Set(["n", "s", "e", "w", "ne", "nw", "se", "sw", "north", "south", "east", "west"]);

/**
 * "827 Nantucket Ave" -> "Nantucket" — reads like a real text ("saw your
 * listing on Nantucket go up") instead of a form letter. Falls back to the
 * full address unchanged for anything that doesn't start with a house
 * number (e.g. new-construction "plan" names like "The Buckner Plan").
 */
export function shortStreetName(address: string | null): string | null {
  if (!address) return null;
  const words = address.trim().split(/\s+/);
  if (words.length === 0 || !/^\d+[a-zA-Z]?$/.test(words[0])) return address;

  let rest = words.slice(1);
  if (rest.length > 1 && DIRECTIONALS.has(rest[0].toLowerCase().replace(/\.$/, ""))) {
    rest = rest.slice(1);
  }
  if (rest.length > 1 && STREET_SUFFIXES.has(rest[rest.length - 1].toLowerCase().replace(/\.$/, ""))) {
    rest = rest.slice(0, -1);
  }
  return rest.join(" ") || address;
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
  const street = shortStreetName(address) ?? "your property";
  return `Hey there${name ? ` ${name}` : ""}, I'm Lukas. I just saw your listing on ${street} go up. Do you have photos handled yet, or could I help you get some taken care of quickly?
I'm a local real estate photographer, I'd be happy to put you down for this week.`;
}

export function followUpMessage(agentName: string | null, address: string | null): string {
  const name = firstName(agentName);
  return `Hi${name ? ` ${name}` : ""}, just following up on ${
    address ?? "the property"
  } — let me know if you're still looking for a photographer!`;
}
