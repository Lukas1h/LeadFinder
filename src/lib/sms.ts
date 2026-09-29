export function firstName(fullName: string | null): string | null {
  if (!fullName) return null;
  return fullName.trim().split(/\s+/)[0] || null;
}

// Abbreviation -> the full word a person would say, lowercase on purpose:
// "South Bank road" reads like a text, "South Bank Road" like a form.
const STREET_SUFFIXES: Record<string, string> = {
  ave: "avenue", avenue: "avenue", st: "street", street: "street", ln: "lane", lane: "lane",
  rd: "road", road: "road", dr: "drive", drive: "drive", blvd: "boulevard", boulevard: "boulevard",
  ct: "court", court: "court", pl: "place", place: "place", way: "way", cir: "circle", circle: "circle",
  ter: "terrace", terrace: "terrace", pkwy: "parkway", parkway: "parkway", trl: "trail", trail: "trail",
  loop: "loop", hwy: "highway", highway: "highway",
};

const DIRECTIONALS: Record<string, string> = {
  n: "North", s: "South", e: "East", w: "West", ne: "Northeast", nw: "Northwest", se: "Southeast",
  sw: "Southwest", north: "North", south: "South", east: "East", west: "West",
  northeast: "Northeast", northwest: "Northwest", southeast: "Southeast", southwest: "Southwest",
};

// Street names that sound odd on their own ("your listing on Bank", "on
// Main") and need their suffix to read naturally ("Bank road", "Main
// street"). Anything distinctive ("Burntwood", "Nantucket") reads fine bare.
const COMMON_STREET_WORDS = new Set([
  "main", "bank", "oak", "pine", "elm", "ash", "cedar", "maple", "birch", "fir", "spruce", "walnut",
  "cherry", "park", "lake", "hill", "river", "mill", "church", "school", "market", "center", "centre",
  "spring", "garden", "valley", "view", "grove", "ridge", "meadow", "forest", "sunset", "highland",
  "broadway", "front", "water", "bridge", "orchard", "vine", "rose", "lincoln", "washington", "jackson",
  "madison", "jefferson", "franklin", "adams", "grant", "court", "state", "union", "college", "summit",
  "harbor", "bay", "beach", "ocean", "sea", "north", "south", "east", "west", "old", "new", "high",
  "low", "long", "short", "green", "red", "white", "black", "brown", "gold", "silver", "stone", "rock",
]);

const clean = (w: string) => w.toLowerCase().replace(/\.$/, "");

/**
 * The way a person would say the street in a text: "3232 Granada Way S"
 * -> "Granada", "123 S Bank Rd" -> "South Bank road", "88 Burntwood Dr" ->
 * "Burntwood", "12 Main St" -> "Main street", "400 Hwy 99" -> "highway 99".
 * Directions are spelled out. The suffix is dropped when the name is
 * distinctive enough to stand alone, and kept (lowercase, unabbreviated)
 * when the bare name would sound odd: common words, numbered streets, very
 * short names, or when there's a leading direction. Falls back to the full
 * address for anything that doesn't start with a house number (e.g.
 * new-construction "The Buckner Plan").
 */
export function naturalStreetName(address: string | null): string | null {
  if (!address) return null;
  const words = address.trim().replace(/,.*$/, "").split(/\s+/);
  if (words.length === 0 || !/^\d+[a-zA-Z]?$/.test(words[0])) return address;

  let rest = words.slice(1);
  // Unit designators after the street ("Apt 4", "#12", "Unit B").
  const unitAt = rest.findIndex((w) => /^(#|apt|unit|ste|suite|spc|space)/i.test(w));
  if (unitAt > 0) rest = rest.slice(0, unitAt);

  // "Hwy 99" / "Highway 138": the suffix comes first.
  if (rest.length >= 2 && (clean(rest[0]) === "hwy" || clean(rest[0]) === "highway")) {
    return `highway ${rest.slice(1).join(" ")}`;
  }

  let leadingDirection: string | null = null;
  if (rest.length > 1 && DIRECTIONALS[clean(rest[0])]) {
    leadingDirection = DIRECTIONALS[clean(rest[0])];
    rest = rest.slice(1);
  }
  // A trailing direction ("Granada Way S") adds nothing when said aloud.
  if (rest.length > 1 && DIRECTIONALS[clean(rest[rest.length - 1])]) rest = rest.slice(0, -1);

  let suffix: string | null = null;
  if (rest.length > 1 && STREET_SUFFIXES[clean(rest[rest.length - 1])]) {
    suffix = STREET_SUFFIXES[clean(rest[rest.length - 1])];
    rest = rest.slice(0, -1);
  }
  if (rest.length === 0) return address;

  const name = rest.join(" ");
  const lone = rest.length === 1 ? clean(rest[0]) : null;
  const needsSuffix =
    suffix != null &&
    (leadingDirection != null ||
      /^\d/.test(name) ||
      (lone != null && (lone.length <= 4 || COMMON_STREET_WORDS.has(lone))));

  return [leadingDirection, name, needsSuffix ? suffix : null].filter(Boolean).join(" ");
}

// Used when a listing has no agent phone on file — opens the compose sheet
// with a placeholder recipient instead of doing nothing, so the drafted
// text isn't lost; swap in the real number/contact once you have it.
const PLACEHOLDER_PHONE = "+10000000000";

export function smsUrl(phone: string = "default", message: string): string {
  const digits = phone.replace(/\D/g, "");
  let target: string;
  if (digits.length === 10) target = `+1${digits}`;
  else if (digits.length === 11 && digits.startsWith("1")) target = `+${digits}`;
  else target = PLACEHOLDER_PHONE;

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const separator = isIOS ? "&" : "?";
  return `sms:${target}${separator}body=${encodeURIComponent(message)}`;
}

export function telUrl(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `tel:+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `tel:+${digits}`;
  return null;
}
