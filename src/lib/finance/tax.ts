/**
 * The tax side of the ledger: the IRS mileage rate a trip earns, and an
 * estimate of what the business's profit costs in tax. Client-safe (pure).
 *
 * The estimate is for planning (is this job worth it, what do deductions
 * save, what to set aside), not for filing. It assumes a single filer whose
 * only other income is W-2 wages (Lukas's other jobs, from Settings), the
 * business filed on Schedule C, and the standard deduction. What it leaves
 * out (credits, the Oregon personal exemption credit) mostly cancels, since
 * the business's tax is taken as the difference between the year's tax with
 * and without the business.
 */

// IRS business standard mileage rates, by the date they took effect. 2026's
// changed mid-year: 72.5 cents through June, 76 cents from July 1.
const MILEAGE_RATES: { from: string; rate: number }[] = [
  { from: "2025-01-01", rate: 0.7 },
  { from: "2026-01-01", rate: 0.725 },
  { from: "2026-07-01", rate: 0.76 },
];

/** Dollars per business mile for a trip on this "YYYY-MM-DD" date. */
export function mileageRate(date: string): number {
  let rate = MILEAGE_RATES[0].rate;
  for (const r of MILEAGE_RATES) if (date >= r.from) rate = r.rate;
  return rate;
}

interface TaxYear {
  federalStandardDeduction: number;
  /** [top of the bracket, rate]; the last bracket's top is Infinity. */
  federalBrackets: [number, number][];
  socialSecurityWageBase: number;
  oregonStandardDeduction: number;
  oregonBrackets: [number, number][];
  /** Oregon lets federal income tax be subtracted, up to this much. */
  oregonFederalTaxSubtractionCap: number;
}

const TAX_YEARS: Record<number, TaxYear> = {
  2026: {
    federalStandardDeduction: 16100,
    federalBrackets: [
      [12400, 0.1],
      [50400, 0.12],
      [105700, 0.22],
      [201775, 0.24],
      [256225, 0.32],
      [640600, 0.35],
      [Infinity, 0.37],
    ],
    socialSecurityWageBase: 184500,
    oregonStandardDeduction: 2745,
    oregonBrackets: [
      [4050, 0.0475],
      [10200, 0.0675],
      [125000, 0.0875],
      [Infinity, 0.099],
    ],
    oregonFederalTaxSubtractionCap: 8500,
  },
};

function taxYear(year: number): TaxYear {
  if (TAX_YEARS[year]) return TAX_YEARS[year];
  const known = Object.keys(TAX_YEARS).map(Number);
  return TAX_YEARS[year < Math.min(...known) ? Math.min(...known) : Math.max(...known)];
}

function bracketTax(income: number, brackets: [number, number][]): number {
  let tax = 0;
  let bottom = 0;
  for (const [top, rate] of brackets) {
    if (income <= bottom) break;
    tax += (Math.min(income, top) - bottom) * rate;
    bottom = top;
  }
  return tax;
}

export interface TaxBreakdown {
  selfEmployment: number;
  federal: number;
  oregon: number;
  total: number;
}

/** The whole year's income tax and self-employment tax for wages plus business profit. */
function yearTax(year: number, wages: number, profit: number): TaxBreakdown {
  const t = taxYear(year);

  // Self-employment tax: 15.3% on 92.35% of profit, Social Security's share
  // only up to the wage base left after W-2 wages. Nothing under $400.
  const seEarnings = Math.max(0, profit) * 0.9235;
  const selfEmployment =
    seEarnings < 400
      ? 0
      : 0.124 * Math.min(seEarnings, Math.max(0, t.socialSecurityWageBase - wages)) + 0.029 * seEarnings;

  const agi = wages + profit - selfEmployment / 2;
  const beforeQbi = Math.max(0, agi - t.federalStandardDeduction);
  // The 20% qualified business income deduction, federal only.
  const qbi = Math.min(Math.max(0, profit - selfEmployment / 2) * 0.2, beforeQbi * 0.2);
  const federal = bracketTax(beforeQbi - qbi, t.federalBrackets);

  const oregonTaxable = Math.max(
    0,
    agi - t.oregonStandardDeduction - Math.min(federal, t.oregonFederalTaxSubtractionCap)
  );
  const oregon = bracketTax(oregonTaxable, t.oregonBrackets);

  return { selfEmployment, federal, oregon, total: selfEmployment + federal + oregon };
}

/**
 * The tax the business's profit adds on top of the wages: what the year's
 * return owes with it, minus what it would owe on the wages alone.
 */
export function businessTax(year: number, wages: number, profit: number): TaxBreakdown {
  const withBusiness = yearTax(year, wages, profit);
  const without = yearTax(year, wages, 0);
  return {
    selfEmployment: withBusiness.selfEmployment - without.selfEmployment,
    federal: withBusiness.federal - without.federal,
    oregon: withBusiness.oregon - without.oregon,
    total: withBusiness.total - without.total,
  };
}

/** What a set of deductions saves: the business's tax without them, minus with them. */
export function taxSaved(year: number, wages: number, profitAfterDeductions: number, deductions: number): number {
  return (
    businessTax(year, wages, profitAfterDeductions + deductions).total -
    businessTax(year, wages, profitAfterDeductions).total
  );
}

/** The tax on one more dollar of profit, at this profit. */
export function marginalRate(year: number, wages: number, profit: number): number {
  return (businessTax(year, wages, profit + 100).total - businessTax(year, wages, profit).total) / 100;
}
