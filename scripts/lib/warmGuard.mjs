// Warm-agent guard: the last line of defense before a cold email goes out.
//
// THE FAILURE MODE THIS EXISTS TO PREVENT
// Cold-emailing someone we already have a relationship with. They asked us to
// shoot their listing, we quoted, they declined, we followed up twice — and
// then a scraped list that never heard of any of that hands us their inbox and
// we send "Saw your listing, thought a backup photographer would help." That is
// not a wasted send; it is an agent who now thinks we don't keep track of our
// own pipeline. One of those can cost the referrals a dozen cold emails were
// trying to buy.
//
// So the rule is asymmetric on purpose. A missed match (a stranger held back)
// costs one email. A false "clear" costs the relationship. Every comparison
// here is tuned to over-flag, and the only verdict that reaches the sender is
// `clear` — `block` and `review` both stop the send for a human to resolve.
//
// Pure functions, no DB, no network. Loaded by warmGuard.ts; tested in
// warm-guard.test.mjs.

// ---------------------------------------------------------------------------
// Given names
// ---------------------------------------------------------------------------
// ALIAS maps a spelling to the set of canonical names it can stand for. A
// plain one-to-one nickname map can't express ambiguity: "Pat" is short for
// both Patrick and Patricia, and a one-to-one entry has to lie about one of
// them. Sets let the ambiguity be real — "Pat Young" collides with BOTH
// "Patrick Young" and "Patricia Young", which is exactly the over-flag this
// file wants. Two names are nickname-equivalent when their canonical sets
// intersect; "Patrick" and "Patricia" share nothing, so they stay distinct
// people even though "Pat" reaches both.
const ALIAS = {
  // Unambiguous diminutives: these block, they're the Becky/Rebecca case.
  becky: ["rebecca"], becca: ["rebecca"], rebbie: ["rebecca"], reba: ["rebecca"],
  bob: ["robert"], rob: ["robert", "roberta"], bobby: ["robert"], robbie: ["robert"],
  bill: ["william"], billy: ["william"], will: ["william"], willie: ["william"],
  dick: ["richard"], rick: ["richard"], ricky: ["richard"], rich: ["richard"], richie: ["richard"],
  jim: ["james"], jimmy: ["james"], jamie: ["james"],
  mike: ["michael"], mikey: ["michael"], mick: ["michael"],
  chris: ["christopher"], kit: ["christopher"], topher: ["christopher"],
  dan: ["daniel"], danny: ["daniel"],
  steve: ["stephen", "steven"], stevie: ["stephen", "steven"],
  tom: ["thomas"], tommy: ["thomas"],
  joe: ["joseph"], joey: ["joseph"],
  tony: ["anthony"], ant: ["anthony"],
  andy: ["andrew"], drew: ["andrew"],
  ben: ["benjamin"], benny: ["benjamin"],
  matt: ["matthew"], matty: ["matthew"],
  nick: ["nicholas"], nico: ["nicholas"],
  liz: ["elizabeth"], beth: ["elizabeth"], betty: ["elizabeth"],
  eliza: ["elizabeth"], lizzie: ["elizabeth"], libby: ["elizabeth"],
  kate: ["katherine", "catherine"], kathy: ["katherine"], katie: ["katherine"],
  kathryn: ["katherine"], kath: ["katherine"], cass: ["catherine"],
  cassie: ["catherine"], cath: ["catherine"],
  sue: ["susan"], suzy: ["susan"], susie: ["susan"],
  jen: ["jennifer"], jenny: ["jennifer"], jenn: ["jennifer"],
  meg: ["margaret"], maggie: ["margaret"], peggy: ["margaret"],
  marge: ["margaret"], margie: ["margaret"],
  debbie: ["deborah"], debra: ["deborah"], deb: ["deborah"],
  barb: ["barbara"], barbie: ["barbara"], babs: ["barbara"],
  cindy: ["cynthia"], cindie: ["cynthia"], cyndi: ["cynthia"],
  sandy: ["sandra"], sandie: ["sandra"],
  terri: ["teresa"], tess: ["teresa"], teresa: ["teresa"],
  fran: ["frances", "francis"], jan: ["janet"],
  dot: ["dorothy"], dottie: ["dorothy"], dori: ["dorothy"],
  ken: ["kenneth"], kenny: ["kenneth"],
  larry: ["lawrence"], laurence: ["lawrence"],
  greg: ["gregory"], gregg: ["gregory"],
  tim: ["timothy"], timmy: ["timothy"],
  jeff: ["jeffrey"], geoff: ["geoffrey", "jeffrey"],
  zach: ["zachary"], zack: ["zachary"],
  dave: ["david"], davey: ["david"],
  gabe: ["gabriel"],
  kim: ["kimberly"], kimmy: ["kimberly"],
  jess: ["jessica"], jessie: ["jessica"],
  britt: ["brittany"], brit: ["brittany"],
  megg: ["megan"], meggie: ["megan"],
  nat: ["natalie", "natalia"], natty: ["natalie", "natalia"],
  dana: ["danielle"], dani: ["danielle"],
  tori: ["victoria"], vicki: ["victoria"], vicky: ["victoria"],
  vera: ["veronica"], vonnie: ["yvonne"],
  lori: ["lorraine"], steph: ["stephanie"], steff: ["stephanie"],
  abby: ["abigail"], abbie: ["abigail"], gail: ["abigail"],
  xander: ["alexander"], alec: ["alexander"],
  mickey: ["michael"], Peanut: [],
  hal: ["gerald", "harold"], harry: ["henry", "harold"], hank: ["henry"],
  herb: ["herbert"], ivan: ["ivan"], wes: ["wesley"],
  toby: ["tobias"], ned: ["edward"], abe: ["abraham"],
  vic: ["victor"], wally: ["walter"], gus: ["augustus"],
  gene: ["eugene"], rafe: ["rafael"], milo: ["milo"],
  sasha: ["alexandra"], sash: ["alexandra"], lexi: ["alexandra"],
  allie: ["alexandra"], meg: ["margaret"],
  kirsty: ["kristen"], kristen: ["kristen"],
  // Ambiguous short forms — real standalone names as well as diminutives, so
  // a nickname hit involving one of these is a review, never a block.
  amy: ["amelia", "amy"], may: ["mary", "may"], jo: ["joanne", "joanna", "jo"],
  pat: ["patrick", "patricia"], sam: ["samuel", "samantha"],
  alex: ["alexander", "alexandra", "alexis"],
  dan2: [], jess2: [], kim2: [], rose: ["rose"], jade: ["jade"],
  faith: ["faith"], hope: ["hope"], ted: ["edward", "theodore"],
  terry: ["teresa", "terrence"], jerry: ["gerald", "geraldine", "jerome"],
  gerry: ["gerald", "geraldine"], ronnie: ["ronald", "veronica"],
  don: ["donald"], donnie: ["donald"], jill: ["jill"],
  mick: ["michael"], connie: ["constance"], connie2: [],
  bobbie: ["robert"], sammie: ["samuel", "samantha"], tan: ["tanya"],
  cassie2: [], ginny: ["ginna", "virginia"], vinny: ["vincent", "virginia"],
};

// Names that are BOTH a common standalone given name AND a diminutive. For
// these a nickname collision is genuinely ambiguous — "Pat Young" could be
// Patrick or Patricia, "Chris Davis" could be Christopher or Christina — so a
// hit is downgraded from `block` to `review`. Still held; never auto-sent.
//
// Deliberately short. An earlier draft listed every diminutive here, which
// demoted Bob/Robert, Bill/William, Mike/Michael and a dozen other certainties
// to review and buried the real cases. A diminutive with no life of its own
// (Liz, Ken, Greg) is strong evidence; only the true overlap goes here.
const AMBIGUOUS_GIVEN = new Set([
  "amy", "may", "jo", "pat", "sam", "alex", "chris", "terry", "jerry",
  "gerry", "ronnie", "sandy", "kate", "cindy", "sue", "kim", "jess", "nat",
  "dot", "hal", "harry", "jan", "dana", "vera", "sammie", "ted", "jill",
  "fran", "stacy", "cassie", "max", "ollie", "jake", "nicole", "vicki",
]);

// Suffixes are not part of the surname. "Kenneth Terhaar III" and "Kenneth
// Terhaar" are one person; "Jr" could be a father/son pair, but for a
// hold-back decision possibly-same is the answer we want.
const SUFFIXES = new Set([
  "jr", "sr", "ii", "iii", "iv", "v", "vi", "2nd", "3rd", "4th",
  "esq", "phd", "md", "mba", "dvm", "cpa",
]);

// Words that are part of nearly any brokerage's name, or that appear in
// scraped page furniture. Used for the "two or more of these = an
// organization" rule.
const ORG_TOKENS = new Set([
  "our", "the", "broker", "brokers", "realty", "real", "estate", "properties",
  "property", "homes", "home", "group", "team", "associates", "partners",
  "company", "co", "corp", "inc", "llc", "ltd", "office", "staff", "customer",
  "service", "services", "support", "sales", "info", "admin", "noreply",
  "accessibility", "statement", "privacy", "terms", "contact", "directory",
  "radio", "pmi", "management", "leasing", "rentals", "title", "escrow",
  "mortgage", "lending", "insurance", "builder", "construction", "collect",
  "collective", "listing", "listings", "webmaster", "postmaster", "unsubscribe",
  "donotreply", "coldwell", "banker", "homesmart", "keller", "williams",
  "century", "compass", "windermere", "sotheby", "hasson", "stellar", "brokerage",
  "brokered", "toll", "brothers", "sisters", "usa", "nw", "ne", "sw", "se",
  "essentials", "thinking", "academy", "institute", "school", "university",
  "college", "solutions", "systems", "advisors", "holdings", "ventures",
  "capital", "consulting", "services",
]);

// Strong organization evidence: a firm word that is essentially never a
// surname. One of these anywhere in the name is enough to hold the row.
const FIRM_NON_SURNAME = new Set([
  "brokers", "broker", "brokerage", "brokered", "realty", "realtors",
  "properties", "radio", "pmi", "statement", "accessibility", "privacy",
  "terms", "unsubscribe", "donotreply", "noreply", "webmaster", "postmaster",
  "coldwell", "banker", "homesmart", "remax", "compass", "windermere",
  "sotheby", "keller", "williams", "stellar", "knipe", "century",
  "hss", "kw", "kwc", "toll", "tollbrothers", "collect", "collective",
  "homes", "mortgage", "lending", "escrow", "leasing", "rentals", "directory",
  "listing", "listings", "rokr", "rokerage", "exp",
  // NOT here: "hasson". Cascade Hasson is a brokerage, but Hasson is also the
  // surname of real agents (Jenna Hasson, Tracy Hasson), and listing the firm
  // name here held two genuine people as "reads as an organization".
]);

// A lone token from this set is an organization, not a person.
const SINGLE_BAD = new Set([
  "team", "brokers", "broker", "radio", "info", "admin", "office", "staff",
  "support", "sales", "contact", "directory", "group", "associates",
  "partners", "service", "services", "tollbrothers", "unsubscribe", "help",
  "marketing", "homesmart", "remax", "compass", "kw", "kwc", "hss",
]);

// Place/direction words. Never a person's first name, so one in first
// position means the row is a place, not a person ("Hi Downtown").
const PLACE_WORDS = new Set([
  "downtown", "uptown", "midtown", "north", "south", "east", "west", "northeast",
  "northwest", "southeast", "southwest", "nw", "ne", "sw", "se", "central",
  // States and cities that are never a given name.
  // NOT here: "eugene", "salem", "bend", "medford", "ashland", "sandy" — all
  // real Oregon cities AND real first names. "eugene" flagged Eugene Petrusha,
  // a real agent in Springfield, as if the row were a place name.
  "oregon", "washington", "idaho", "portland", "gresham", "tigard",
  "beaverton", "hillsboro", "corvallis", "roseburg", "mcminnville", "newberg",
  "the", "ninebark",
]);

// Words stripped from the FRONT of a name when a brokerage/geo string has
// been glued onto a real person's name ("Love Oregon.House Ashley Jensen").
// Only ever stripped from the front, and only while more than two tokens
// remain, so "Sandy Lane" and "Home Smith" survive intact.
const LEADING_NOISE = new Set([
  "love", "oregon", "house", "homes", "realty", "real", "estate", "properties",
  "property", "group", "team", "the", "our", "broker", "brokers", "brokerage",
  "coldwell", "banker", "homesmart", "kw", "keller", "williams", "remax",
  "compass", "windermere", "sotheby", "hasson", "stellar", "toll", "brothers",
  "central", "oregon", "washington", "idaho", "nw", "south", "north", "east",
  "west", "portland", "bend", "eugene", "listing", "listings", "accessibility",
  "statement", "privacy", "terms", "info", "admin", "office",
]);

/** Strip accents so "Muñoz" and "Munoz" compare equal. */
function deaccent(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Lowercase, deaccent, reduce to a-z. */
export function norm(s) {
  return deaccent(s).toLowerCase().replace(/[^a-z]/g, "");
}

/** Canonical set for a given name: itself plus every alias it can stand for. */
function canonicalSet(name) {
  const n = norm(name);
  const out = new Set([n]);
  for (const a of ALIAS[n] || []) out.add(norm(a));
  return out;
}

/**
 * Split a display name into { first, last, tokens }.
 * Handles the junk that shows up in scraped rosters:
 *   'Jose "Joe" Arechiga Molinar'    -> first "jose",  last "molinar"
 *   'KENNETH R. TERHAAR III'          -> first "kenneth", last "terhaar"
 *   'Love Oregon.House Ashley Jensen'  -> first "ashley", last "jensen"
 *   'B. Rhoda'                        -> first "b",     last "rhoda"
 *   'Cynthia Moneymaker'              -> first "cynthia", last "moneymaker"
 *   single token 'Downtown'           -> first "downtown", last ""
 * Hyphens and apostrophes are KEPT so "Anna Smith-Jones" and "Seamus O'Brien"
 * still resolve to a real surname.
 */
export function parseName(raw) {
  const cleaned = deaccent(String(raw || ""))
    .toLowerCase()
    .replace(/[^a-z0-9'\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const rawTokens = cleaned.split(" ").filter(Boolean);
  const tokens = [...rawTokens];
  while (tokens.length > 2 && LEADING_NOISE.has(tokens[0])) tokens.shift();
  while (tokens.length > 1 && SUFFIXES.has(tokens[tokens.length - 1])) tokens.pop();
  if (tokens.length > 2 && tokens[1].length === 1) tokens.splice(1, 1);
  const first = tokens[0] || "";
  const last = tokens.length > 1 ? tokens[tokens.length - 1] : "";
  return { first, last, tokens, rawTokens, normFirst: norm(first), normLast: norm(last) };
}

/** Damerau-Levenshtein distance with an early exit past `max`. */
export function editDistance(a, b, max = 4) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2 = null;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (prev2 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1);
      }
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

/** Are a and b the same string with one adjacent pair of letters swapped?
 *  "Recibecca"/"Rebecca" yes; "Kristopher"/"Christopher" no (a two-letter
 *  block moved, which is distance 2). This distinction is what lets a real
 *  typo block while a merely-similar distinct name only reviews. */
function isAdjacentTransposition(a, b) {
  if (a.length !== b.length || a === b) return false;
  const diff = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) { diff.push(i); if (diff.length > 2) return false; }
  }
  return diff.length === 2 && diff[1] === diff[0] + 1 &&
    a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]];
}

/** Soundex — catches spelling variants edit distance rates too far apart
 *  ("Hasson"/"Hason", "Larson"/"Larsen"). A review signal only; Soundex
 *  collides on plenty of unrelated names. */
export function soundex(s) {
  const t = norm(s).toUpperCase();
  if (!t) return "";
  const codes = { B: 1, F: 1, V: 1, P: 1, C: 2, G: 2, J: 2, K: 2, Q: 2, S: 2, X: 2, Z: 2, D: 3, T: 3, L: 4, M: 5, N: 5, R: 6 };
  let out = t[0];
  let last = codes[t[0]] ?? 0;
  for (let i = 1; i < t.length; i++) {
    const c = codes[t[i]] ?? 0;
    if (c && c !== last) out += c;
    last = c;
    if (t[i] === "H" || t[i] === "W") last = 0;
  }
  return (out + "000").slice(0, 4);
}

/** Collapse a repeated letter run: "Ssssmith" -> "smith". */
function squeeze(s) { return s.replace(/(.)\1+/g, "$1"); }

function isTransposed(a, b) { return isAdjacentTransposition(squeeze(a), squeeze(b)); }

/** Length of the shared leading character run. */
function commonPrefixLen(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

/**
 * Every form a name part should be compared in.
 *
 * "Anna Smith-Jones" against a DB row that says "Anna Smith" is the same human,
 * and a straight lastNameMatch("smithjones", "smith") returns "none" — a false
 * CLEAR, which is the one answer this file must never get wrong. So each part
 * is also compared by its hyphen components, in both directions, and the best
 * result wins. First names get the same treatment ("Mary-Jo" vs "Mary").
 */
export function namePartVariants(rawPart) {
  const out = new Set();
  const whole = norm(rawPart);
  if (whole) out.add(whole);
  // Hyphens only. Splitting on the apostrophe too would shatter "O'Brien" into
  // "o" + "brien", and a bare "o" then matches any O-something.
  for (const piece of String(rawPart || "").split("-")) {
    const p = norm(piece);
    if (p && p !== whole) out.add(p);
  }
  return [...out];
}

/** Best (strongest) match across variant pairs. `order` lists tiers from
 *  strongest to weakest; "none" is the floor and always loses. */
function bestAcross(variantsA, variantsB, fn, order) {
  let best = "none";
  for (const a of variantsA) {
    for (const b of variantsB) {
      const r = fn(a, b);
      if (r === "none") continue;
      if (best === "none" || order.indexOf(r) < order.indexOf(best)) best = r;
    }
  }
  return best;
}

const FIRST_ORDER = ["exact", "nickname", "transposed", "prefix", "typo", "weak", "phonetic"];
const LAST_ORDER = ["exact", "transposed", "typo", "weak", "phonetic"];

/** Does this name part match at the `typo` tier — one substitution, insertion
 *  or deletion? Needs 5+ characters, because on a 4-character name a single
 *  edit is most of the name. */
function atTypoTier(x, y) {
  return Math.min(x.length, y.length) >= 5 && editDistance(x, y, 1) <= 1;
}

/**
 * Does this name part match at the `weak` tier — two edits?
 *
 * This is where the matcher is easiest to get wrong in the noisy direction.
 * Two edits on a short name is not a typo, it is a different name: "lang" vs
 * "bany" and "furlan" vs "duran" are both distance 2, and an earlier version
 * that accepted distance 2 for any 4+ character name held 73 of 405 rows on the
 * first real list it saw — 18% noise, which is how a guard gets ignored.
 *
 * So two edits only counts when the names are long enough for two edits to be a
 * small fraction of the name (8+), or when they visibly share a stem
 * (2+ leading characters), or when Soundex agrees as well. That keeps the
 * genuine typo catches — "Kristopher"/"Christopher", "Recibecca"/"Rebecca",
 * "Rhoda"/"Rholda" — while letting the coincidence pairs through.
 */
function atWeakTier(x, y) {
  const minLen = Math.min(x.length, y.length);
  if (minLen < 5) return false;
  if (editDistance(x, y, 2) > 2) return false;
  // Long enough that two edits are a small fraction of the name.
  if (minLen >= 8) return true;
  // A visible shared stem: "andersen"/"anderson", "mikkelsen"/"mikkleson".
  if (commonPrefixLen(x, y) >= 3 && minLen >= 6) return true;
  // Soundex alone, and only on names long enough for the code to mean
  // something. Below 7 characters Soundex is close to a coin flip, and
  // trusting it held Jenna Hasson against "Kenna Higson" and Tracy Hasson
  // against "Tricia Hansen" — two real agents, two coincidences.
  if (soundex(x) === soundex(y) && minLen >= 7) return true;
  return false;
}

/**
 * Do two given names refer to the same person? Tiers, most confident first:
 *   exact | nickname | transposed | prefix | typo | weak | phonetic | none
 */
export function firstNameMatch(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return "none";
  const ax = squeeze(x), ay = squeeze(y);
  if (ax === ay) return "exact";

  const ca = canonicalSet(a), cb = canonicalSet(b);
  for (const v of ca) if (cb.has(v)) return "nickname";

  if (isTransposed(x, y)) return "transposed";
  if (x.length >= 4 && y.length >= 4 && (ax.startsWith(ay) || ay.startsWith(ax))) return "prefix";
  const shorter = ax.length < ay.length ? ax : ay;
  const longer = ax.length < ay.length ? ay : ax;
  if (shorter.length >= 5 && longer.startsWith(shorter)) return "prefix";
  if (atTypoTier(x, y)) return "typo";
  // A long shared prefix that then diverges at the tail is two different
  // names, not a misspelling: Patrick/Patricia, Daniel/Daniela, Susan/Suzanne.
  // Real name typos land at the front ("Kristopher") or as a transposition,
  // not as a clean tail swap. Getting this wrong would hold every Patrick and
  // Patricia on the roster, which trains people to ignore the guard.
  const cp = commonPrefixLen(ax, ay);
  if (cp >= 5 && Math.min(ax.length, ay.length) - cp <= 2) return "none";
  if (atWeakTier(x, y)) return "weak";
  if (x.length >= 3 && y.length >= 3 && soundex(x) === soundex(y)) return "phonetic";
  return "none";
}

/** Same tiers for surnames. */
export function lastNameMatch(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return "none";
  const ax = squeeze(x), ay = squeeze(y);
  if (ax === ay) return "exact";
  if (isTransposed(x, y)) return "transposed";
  if (atTypoTier(x, y)) return "typo";
  if (atWeakTier(x, y)) return "weak";
  if (x.length >= 4 && y.length >= 4 && soundex(x) === soundex(y)) return "phonetic";
  return "none";
}

// Org words that are also surnames, so their presence says nothing on its own
// unless something else in the row corroborates.
const SURNAME_SHAPED_ORG = new Set([
  "home", "homes", "team", "group", "real", "estate", "office", "staff",
  "service", "services", "sales", "partners", "associates", "brothers",
  "sisters", "properties", "property", "land", "lending", "title", "west",
  "north", "south", "east", "center", "point", "park", "hill", "hills",
  "lake", "river", "wood", "woods", "field", "fields", "stone", "ridge",
  "view", "garden", "gardens", "grove", "creek", "ranch", "farm", "haven",
  "vista", "summit", "peak", "bridge", "crossing", "side",
]);

// Org words that are essentially never surnames. One of these in the final
// position ends the row: "AOR Essentials", "ENRG Thinking" are companies, and
// a trailing "Essentials"/"Thinking" is what gives them away.
const TRAILING_FIRM = new Set([
  "essentials", "thinking", "academy", "institute", "school", "university",
  "college", "solutions", "systems", "advisors", "holdings", "ventures",
  "capital", "consulting", "radio", "statement", "directory", "listings",
  "listing", "support", "customer", "unsubscribe", "donotreply", "noreply",
  "webmaster", "postmaster", "accessibility", "privacy", "terms", "escrow",
  "leasing", "rentals", "mortgage", "insurance", "construction", "builder",
  "management", "pmi", "info", "admin", "contact",
]);

/** Does this name look like a brokerage/org rather than a person? */
export function looksLikeOrg(name) {
  const p = parseName(name);
  if (p.rawTokens.length === 0) return { org: true, reason: "empty_name" };
  // Judge on the RAW tokens, not the prefix-stripped ones. "HOMES BY CRANE"
  // loses "homes" to the leading-noise strip and then reads as a person
  // called "By Crane" — the firm word has to be seen before it's discarded.
  const all = p.rawTokens;
  // A direction/place word in first position is never a person: this is the
  // "Downtown Ninebark" case that would render "Hi Downtown".
  if (PLACE_WORDS.has(all[0])) return { org: true, reason: `place_word:${all[0]}` };
  for (const t of all) {
    if (FIRM_NON_SURNAME.has(t)) return { org: true, reason: `firm_word:${t}` };
  }
  // A firm word in surname position ("AOR Essentials", "ENRG Thinking").
  const tail = all[all.length - 1];
  if (all.length > 1 && TRAILING_FIRM.has(tail)) return { org: true, reason: `trailing_firm_word:${tail}` };
  // Two org words, counting the surname-shaped ones ("Our Brokers",
  // "Windermere Realty Trust"). A single surname-shaped org word is not
  // enough — Home, Team, Real and Group are all real last names.
  const orgHits = all.filter((t) => ORG_TOKENS.has(t) && !SURNAME_SHAPED_ORG.has(t));
  if (orgHits.length >= 1 && all.length > 1) {
    const shaped = all.filter((t) => SURNAME_SHAPED_ORG.has(t)).length;
    if (orgHits.length + shaped >= 2) {
      return { org: true, reason: `org_words:${orgHits.concat(all.filter((t) => SURNAME_SHAPED_ORG.has(t))).join("+")}` };
    }
  }
  if (all.length === 1 && (SINGLE_BAD.has(all[0]) || ORG_TOKENS.has(all[0]))) {
    return { org: true, reason: `single_token:${all[0]}` };
  }
  if (/^(info|admin|office|team|support|hello|contact|realtor|realtors|noreply)$/i.test(p.first)) {
    return { org: true, reason: `generic_inbox:${p.first}` };
  }
  return { org: false, reason: "" };
}

/** Last 10 digits only: (503) 555-0123 == 503.555.0123 == +15035550123. */
export function phoneKey(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  if (d.length === 10) return d;
  if (d.length === 11 && d[0] === "1") return d.slice(1);
  if (d.length > 11) return d.slice(-10);
  return d;
}

// Given-name tiers strong enough to block on their own, paired with a strong
// surname. Anything weaker lands on `review` — held, but for a human.
const STRONG_FIRST = new Set(["exact", "nickname", "transposed"]);
const AMBIGUOUS_HIT = new Set(["exact", "nickname", "transposed", "prefix", "typo", "weak", "phonetic"]);

/**
 * Pre-parse a person once so a batch screen doesn't redo it per comparison.
 * Returns the same info matchCandidate derives internally, plus the canonical
 * given-name sets, so the hot loop is two set lookups and a few string tests.
 */
export function preparePerson(person) {
  const p = parseName(person?.name);
  const firsts = namePartVariants(p.first);
  const lasts = p.normLast ? namePartVariants(p.last) : [];
  return {
    name: person?.name || "",
    email: person?.email ? String(person.email).trim().toLowerCase() : null,
    phone: person?.phone ? phoneKey(person.phone) : null,
    tokens: p.tokens,
    firstToken: p.tokens[0] || "",
    firsts,
    lasts,
    hasLast: lasts.length > 0,
    // Canonical sets per first-name variant, precomputed.
    canon: firsts.map((f) => canonicalSet(f)),
  };
}

/**
 * Compare a pre-parsed candidate against a pre-parsed known agent.
 * Same rules and verdicts as matchCandidate, which is the un-prepared
 * single-shot form of this.
 */
export function matchPrepared(cand, prot) {
  // Hard identifiers need no name agreement: a shared email is conclusive, and
  // a shared 10-digit number is treated the same way because the mandate is to
  // over-flag (a broker's office line matching many agents produces a hold for
  // a human, never an automatic send).
  if (cand.email && prot.email && cand.email === prot.email) {
    return { verdict: "block", score: 100, tier: "email", why: `same email as known agent ${prot.name}` };
  }
  if (cand.phone && prot.phone && cand.phone === prot.phone && cand.phone.length === 10) {
    return { verdict: "block", score: 95, tier: "phone", why: `same phone as known agent ${prot.name}` };
  }
  if (!cand.firsts.length) return { verdict: "clear", score: 0, tier: "none", why: "no usable name" };

  // A one-token candidate name ("Rhoda") can't be read as first+last. If that
  // token matches a known agent's first OR last name in any form, hold it.
  if (!cand.hasLast) {
    const one = cand.firsts[0] || "";
    for (const k of prot.firsts.concat(prot.lasts)) {
      if (one === k) {
        return { verdict: "review", score: 60, tier: "single_token", why: `one-word name equals a known agent name (${prot.name})` };
      }
    }
    if (prot.firsts.concat(prot.lasts).some((k) => k.length >= 4 && squeeze(one).startsWith(squeeze(k)))) {
      return { verdict: "review", score: 50, tier: "single_token", why: `one-word name starts with a known agent name (${prot.name})` };
    }
    return { verdict: "clear", score: 0, tier: "none", why: "one-word name, no match" };
  }

  if (!prot.hasLast) {
    // The known agent has no surname on file — three rows in the database are
    // bare first names ("Cindy", "Andre", "Ilya"), the residue of a send where
    // the contact only ever gave a first name. Matching a candidate on a
    // shared first name and nothing else is not evidence: half the agents in
    // this state are named Cindy. Clearing here, and naming the incomplete rows
    // in the run report, is better than holding every Cindy in Oregon.
    if (bestAcross(cand.firsts, prot.firsts, firstNameMatch, FIRST_ORDER) === "exact") {
      return { verdict: "clear", score: 0, tier: "first_only", why: `shared first name with a surname-less record (${prot.name}) — not treated as the same person` };
    }
    return { verdict: "clear", score: 0, tier: "none", why: "known agent has no surname on file" };
  }

  const lm = bestAcross(cand.lasts, prot.lasts, lastNameMatch, LAST_ORDER);
  if (lm === "none") return { verdict: "clear", score: 0, tier: "none", why: "surname differs" };

  // A lone initial instead of a given name ("B. Rhoda" vs "Rebecca Rhoda") plus
  // a matching surname is not enough to clear.
  if (cand.firstToken.length === 1) {
    if (lm === "exact" || lm === "transposed") {
      return { verdict: "review", score: 62, tier: "initial+surname", why: `middle initial + same surname as known agent ${prot.name}` };
    }
    return { verdict: "clear", score: 0, tier: "none", why: "middle initial, surname differs" };
  }

  const fm = bestAcross(cand.firsts, prot.firsts, firstNameMatch, FIRST_ORDER);
  if (fm === "none") {
    // Same surname, unrelated given name: two people who happen to share a
    // name. Never a hold on that alone.
    return { verdict: "clear", score: 0, tier: "none", why: "surname shared, given name unrelated" };
  }

  const ambiguous = cand.canon.some((s) => [...s].some((v) => AMBIGUOUS_GIVEN.has(v))) ||
                    prot.canon.some((s) => [...s].some((v) => AMBIGUOUS_GIVEN.has(v)));
  const strongSurname = lm === "exact" || lm === "transposed";
  const strongFirst = STRONG_FIRST.has(fm);

  // A phonetic first-name hit is only ever a review, never a block: Soundex
  // collides on distinct names constantly (Susan/Suzanne, Craig/Grace), and a
  // false block trains people to wave the guard through.
  const verdict = (strongSurname && strongFirst && !ambiguous) ? "block" : "review";

  const base = { exact: 90, transposed: 88, nickname: 85, prefix: 65, typo: 60, weak: 45, phonetic: 35 }[lm] ?? 30;
  const fAdj = { exact: 10, nickname: 8, transposed: 8, prefix: 2, typo: 0, weak: -5, phonetic: -10 }[fm] ?? 0;
  return {
    verdict,
    score: Math.max(1, Math.min(99, base + fAdj)),
    tier: `${lm}+${fm}`,
    why: `name ${lm}+${fm} vs known agent ${prot.name}`,
  };
}

/**
 * Compare a candidate against one protected agent.
 * @returns {{verdict: "block"|"review"|"clear", score, tier, why}}
 */
export function matchCandidate(cand, prot) {
  return matchPrepared(preparePerson(cand), preparePerson(prot));
}

export const _internals = {
  ALIAS, ORG_TOKENS, FIRM_NON_SURNAME, SINGLE_BAD, PLACE_WORDS,
  LEADING_NOISE, AMBIGUOUS_GIVEN, SUFFIXES, AMBIGUOUS_HIT,
  squeeze, deaccent, canonicalSet, isAdjacentTransposition,
};
