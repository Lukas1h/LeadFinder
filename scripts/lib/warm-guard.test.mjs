// Tests for the warm-agent guard.
//
// The property that matters is asymmetric, and the two halves are tested
// separately on purpose:
//   - FALSE CLEAR is catastrophic  -> assert a hold for anything possibly-same
//   - FALSE BLOCK is merely noisy  -> assert only "not blocked" for the rest
//
//   node --test scripts/lib/warm-guard.test.mjs

import assert from "node:assert/strict";
import test from "node:test";
import {
  matchCandidate, parseName, firstNameMatch, lastNameMatch, namePartVariants,
  looksLikeOrg, phoneKey, soundex, norm,
} from "./warmGuard.mjs";

const P = (name, extra = {}) => ({ name, email: null, phone: null, ...extra });
const v = (cand, knownName) => matchCandidate(cand, P(knownName)).verdict;
const m = (cand, knownName) => matchCandidate(cand, P(knownName));

// ============================================================ must BLOCK
test("Becky Rhoda is caught as Rebecca Rhoda (the case that motivated this)", () => {
  const r = m({ name: "Becky Rhoda", email: "b@x.com" }, "Rebecca Rhoda");
  assert.equal(r.verdict, "block", `expected block, got ${r.verdict} (${r.tier})`);
});

test("the reverse direction also blocks", () => {
  assert.equal(v({ name: "Rebecca Rhoda" }, "Becky Rhoda"), "block");
});

test("unambiguous nickname pairs block", () => {
  for (const [a, b] of [
    ["Bob Smith", "Robert Smith"], ["Bill Jones", "William Jones"],
    ["Dick Wilson", "Richard Wilson"], ["Jim Brown", "James Brown"],
    ["Mike Miller", "Michael Miller"], ["Liz Taylor", "Elizabeth Taylor"],
    ["Jen White", "Jennifer White"], ["Deb Harris", "Deborah Harris"],
    ["Andy Hall", "Andrew Hall"], ["Steve Adams", "Stephen Adams"],
    ["Nick Nelson", "Nicholas Nelson"], ["Meg Carter", "Margaret Carter"],
    ["Kathy Moore", "Katherine Moore"], ["Kath Moore", "Katherine Moore"],
    ["Abby Jones", "Abigail Jones"], ["Dottie Ramos", "Dorothy Ramos"],
    ["Hank Novak", "Henry Novak"], ["Wes Duval", "Wesley Duval"],
  ]) {
    assert.equal(v({ name: a }, b), "block", `${a} vs ${b} -> ${m({ name: a }, b).tier}`);
  }
});

test("a transposed-letter typo blocks", () => {
  assert.equal(v({ name: "Rhdoa Smith" }, "Rhoda Smith"), "block");
  assert.equal(v({ name: "Smtih Brown" }, "Smith Brown"), "block");
  assert.equal(v({ name: "Rebecca Rhodaa" }, "Rebecca Rhoda"), "block");
});

test("hyphenated and apostrophe surnames never slip past", () => {
  // Each of these is a false CLEAR if hyphen handling regresses.
  assert.equal(v({ name: "Anna Smith-Jones" }, "Anna Smith"), "block");
  assert.equal(v({ name: "Anna Smith" }, "Anna Smith-Jones"), "block");
  assert.equal(v({ name: "Kenneth Terhaar Jr" }, "Kenneth Terhaar"), "block");
  assert.equal(v({ name: "Seamus O'Brien" }, "Seamus O'Brien"), "block");
  // A hyphenated given name collides too — held rather than cleared.
  assert.notEqual(v({ name: "Mary-Jo Watts" }, "Mary Watts"), "clear");
});

test("suffixes, middle initials, caps and accents are all normalized away", () => {
  assert.equal(v({ name: "Kenneth R. Terhaar III" }, "Kenneth Terhaar"), "block");
  assert.equal(v({ name: "Kenneth Terhaar" }, "Kenneth Terhaar Jr"), "block");
  assert.equal(v({ name: "AALIYAH MCPHEE" }, "Aaliyah McPhee"), "block");
  assert.equal(v({ name: "Jose Muñoz" }, "Jose Munoz"), "block");
});

test("a brokerage prefix glued onto a real name still matches", () => {
  assert.equal(v({ name: "Love Oregon.House Ashley Jensen" }, "Ashley Jensen"), "block");
});

test("a nickname in quotes doesn't hijack the first name", () => {
  const p = parseName('Jose "Joe" Arechiga Molinar');
  assert.equal(p.first, "jose");
  assert.equal(p.last, "molinar");
  assert.equal(v({ name: 'Jose "Joe" Arechiga Molinar' }, "Jose Molinar"), "block");
});

test("a shared email or phone is a hard block regardless of the name", () => {
  assert.equal(matchCandidate(
    { name: "Totally Different Person", email: "sam@x.com" },
    P("Sam Sample", { email: "sam@x.com" }),
  ).verdict, "block");
  const r = matchCandidate(
    { name: "Someone Else", phone: "(503) 555-0123" },
    P("Real Person", { phone: "503-555-0123" }),
  );
  assert.equal(r.verdict, "block");
  assert.equal(r.tier, "phone");
});

// ================================================ must HOLD (never cleared)
test("an ambiguous short form collides but only reviews", () => {
  // "Pat" reaches both Patrick and Patricia. Either could be the same person,
  // so neither may be emailed — but a collision isn't proof, so: review.
  for (const prot of ["Patrick Young", "Patricia Young"]) {
    assert.equal(v({ name: "Pat Young" }, prot), "review", `Pat Young vs ${prot}`);
  }
  for (const [a, b] of [
    ["Chris Davis", "Christopher Davis"], ["Alex Rivera", "Alexander Rivera"],
    ["Cindy Clark", "Cynthia Clark"],
    ["Daniel Lee", "Daniela Lee"], ["Susan Miller", "Suzanne Miller"],
    ["Maria Garcia", "Marie Garcia"],
    ["Sam Cole", "Samuel Cole"], ["Kate Moore", "Katherine Moore"],
    ["Sandy Lewis", "Sandra Lewis"], ["Jo Hall", "Joanne Hall"],
  ]) {
    assert.equal(v({ name: a }, b), "review", `${a} vs ${b} -> ${m({ name: a }, b).tier}`);
  }
});

test("a lone middle initial plus a matching surname is held", () => {
  assert.equal(v({ name: "B. Rhoda" }, "Rebecca Rhoda"), "review");
  assert.equal(v({ name: "R. Smith" }, "Rebecca Smith"), "review");
  // A different surname really does clear.
  assert.equal(v({ name: "B. Jones" }, "Rebecca Smith"), "clear");
});

test("a one-word candidate name that touches a known agent is held", () => {
  assert.equal(v({ name: "Rhoda" }, "Rebecca Rhoda"), "review");
  assert.equal(v({ name: "Rebecca" }, "Rebecca Rhoda"), "review");
  assert.equal(v({ name: "Zephyr" }, "Rebecca Rhoda"), "clear");
});

test("a phonetic-only similarity is held, never blocked", () => {
  // Soundex collides on distinct names; a hold is right, a block is not.
  for (const [a, b] of [
    ["Susan Miller", "Suzanne Miller"],
  ]) {
    assert.equal(v({ name: a }, b), "review", `${a} vs ${b} -> ${m({ name: a }, b).tier}`);
  }
});

test("a possible typo in either name half is held", () => {
  for (const [a, b] of [
    ["Maria Garcia", "Marie Garcia"],       // one-letter given name
    ["Kristopher Smith", "Christopher Smith"],
    ["Corrie Coffey", "Carrie Coffin"],
    ["Rebecca Rhod", "Rebecca Rhoda"],
    ["Rebecca Rhoda", "Rebecca Rhoad"],
    ["Robert Smith", "Robert Smythe"],      // same first name, Soundex surname
    ["Jenna Hasson", "Kenna Higson"],
  ]) {
    assert.notEqual(v({ name: a }, b), "clear", `${a} vs ${b} cleared — must be held`);
  }
});

test("a shared surname with an unrelated given name clears", () => {
  for (const [a, b] of [
    ["Sarah Johnson", "Michael Johnson"], ["David Miller", "Karen Miller"],
    ["Bob Smith", "Robert Jones"], ["Tom Nguyen", "Thomas Newton"],
    ["Lisa Lang", "Gina Bany"],
    // Short surnames that Soundex alone used to hold. Both released: two
    // coincidences is not a person, and holding them is how a guard gets
    // ignored. "hasson" also has to survive looksLikeOrg — Cascade Hasson is
    // a firm but Jenna and Tracy Hasson are agents.
    ["Shelley Hasson", "Shawn Higson"], ["Tracy Hasson", "Tricia Hansen"],
    ["Patrick Young", "Patricia Young"], ["Alexis Chen", "Alexander Chen"],
    ["Teresa Villa", "Terrence Villa"], ["Ronald Bush", "Veronica Bush"],
    ["Craig Cole", "Grace Cole"], ["Dora Miller", "Dorothy Miller"],
  ]) {
    assert.equal(v({ name: a }, b), "clear", `${a} vs ${b} -> ${m({ name: a }, b).tier}`);
  }
});

test("nickname aliases never collapse two distinct adults into one person", () => {
  for (const [a, b] of [
    ["Patrick Young", "Patricia Young"], ["Katherine Moore", "Catherine Moore"],
    ["Teresa Villa", "Terrence Villa"], ["Ronald Bush", "Veronica Bush"],
    ["Alexis Chen", "Alexander Chen"],
  ]) {
    assert.notEqual(v({ name: a }, b), "block", `${a} vs ${b} must not auto-block`);
  }
});

test("empty and junk input can't crash and never blocks", () => {
  // A surname-less DB row ("Cindy", "Andre") must not hold a candidate on a
  // shared first name alone — half the agents in Oregon are named Cindy.
  assert.equal(v({ name: "Cindy Somsanith" }, "Cindy"), "clear");
  assert.equal(v({ name: "Andre Broadous" }, "Andre"), "clear");

  for (const n of ["", "   ", "-", "N/A", "Unknown", "0", "noreply", "!!!"]) {
    const r = m({ name: n }, "Rebecca Rhoda");
    assert.ok(["clear", "review"].includes(r.verdict), `${JSON.stringify(n)} -> ${r.verdict}`);
  }
  assert.equal(matchCandidate({}, P("Rebecca Rhoda")).verdict, "clear");
  assert.equal(matchCandidate(undefined, P("Rebecca Rhoda")).verdict, "clear");
  assert.equal(matchCandidate({ name: "Rebecca Rhoda" }, {}).verdict, "clear");
  assert.equal(matchCandidate({ name: "Rebecca Rhoda" }, null).verdict, "clear");
});

// ============================================================== junk names
test("brokerage and org rows are recognized", () => {
  for (const n of [
    "HOMESTAR BROKERS", "REAL BROKER", "Our Brokers", "Coldwell Banker",
    "NARPM Radio", "PMI Stumptown", "Accessibility Statement", "Toll Brothers",
    "Windermere Realty Trust", "Downtown", "North", "info@", "Team",
    "Downtown Ninebark", "Homesmart Brokerage", "Jo Properties",
  ]) {
    assert.equal(looksLikeOrg(n).org, true, `${n} should read as an org`);
  }
});

test("real people are not mislabeled as orgs", () => {
  for (const n of [
    "Aaliyah McPhee", "Rebecca Rhoda", "Kenneth Terhaar", "Ashley Jensen",
    "Jose Molinar", "Cynthia Moneymaker", "Sean Peters", "Anna Smith-Jones",
    "Seamus O'Brien", "Deb Harris", "Pat Young", "Jenna Hasson",
    "Tracy Hasson", "Eugene Petrusha",
  ]) {
    assert.equal(looksLikeOrg(n).org, false, `${n} should read as a person`);
  }
});

test("a surname that collides with a firm word still reads as a person", () => {
  // Home, Team, Real and Group are all real surnames; a given name in front
  // saves the row, which is what keeps "Mark Home" out of the held bucket.
  for (const n of ["Mark Home", "Dan Team", "Bob Real", "Amy Group"]) {
    assert.equal(looksLikeOrg(n).org, false, `${n} should read as a person`);
  }
});

// ========================================================= name utilities
test("parseName handles the roster junk", () => {
  const t = parseName("KENNETH R. TERHAAR III");
  assert.equal(t.first, "kenneth");
  assert.equal(t.last, "terhaar");
  const b = parseName('Patricia "Patty" Bolstad');
  assert.equal(b.first, "patricia");
  assert.equal(b.last, "bolstad");
  assert.equal(parseName("B. Rhoda").first, "b");
  const h = parseName("Anna Smith-Jones");
  assert.equal(h.first, "anna");
  assert.equal(h.last, "smith-jones");
});

test("namePartVariants exposes hyphen components", () => {
  assert.deepEqual(namePartVariants("Mary-Jo").sort(), ["jo", "mary", "maryjo"].sort());
  assert.deepEqual(namePartVariants("O'Brien"), ["obrien"]);
});

test("firstNameMatch tiers", () => {
  assert.equal(firstNameMatch("Becky", "Rebecca"), "nickname");
  assert.equal(firstNameMatch("Rhdoa", "Rhoda"), "transposed");
  assert.equal(firstNameMatch("Jon", "John"), "phonetic"); // too short for the typo tier
  assert.equal(firstNameMatch("Kath", "Katherine"), "nickname");
  assert.equal(firstNameMatch("Sarah", "Michael"), "none");
  assert.equal(firstNameMatch("Patrick", "Patricia"), "none");
});

test("lastNameMatch tiers", () => {
  assert.equal(lastNameMatch("Rhoda", "Rhoda"), "exact");
  assert.equal(lastNameMatch("Smtih", "Smith"), "transposed");
  assert.equal(lastNameMatch("Smyth", "Smith"), "typo");
  assert.equal(lastNameMatch("Smith", "Jones"), "none");
});

test("phoneKey normalizes the usual shapes", () => {
  assert.equal(phoneKey("(503) 555-0123"), "5035550123");
  assert.equal(phoneKey("503.555.0123"), "5035550123");
  assert.equal(phoneKey("+15035550123"), "5035550123");
  assert.equal(phoneKey("15035550123"), "5035550123");
});

test("soundex and norm behave", () => {
  assert.equal(soundex("Robert"), "R163");
  assert.equal(soundex("Rupert"), "R163");
  assert.equal(soundex(""), "");
  assert.equal(norm("O'Brien-Smith"), "obriensmith");
  assert.equal(norm("Muñoz"), "munoz");
});
