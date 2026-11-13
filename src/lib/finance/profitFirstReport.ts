/**
 * Loads the ledger and the saved split, then hands both to the client-safe
 * profitFirstReport. The pages and their forms use this; the arithmetic stays
 * in profitFirst.ts so the numbers can be tested without a database.
 */

import { getProfitFirstPercents, loadLedger } from "./ledger";
import { pacificDate } from "./math";
import { profitFirstReport, type ProfitFirstReport } from "./profitFirst";
import { overviewReport } from "./reports";

export async function loadProfitFirstReport(): Promise<ProfitFirstReport> {
  const [ledger, percents] = await Promise.all([loadLedger(), getProfitFirstPercents()]);
  const today = pacificDate(new Date());
  return profitFirstReport(ledger, percents, today, overviewReport(ledger, today).yearTaxOwed);
}
