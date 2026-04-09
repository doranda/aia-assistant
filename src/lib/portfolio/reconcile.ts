// src/lib/portfolio/reconcile.ts — Pure reconciliation math module
// No DB, no side effects. Computes sell/buy totals and units from exact NAVs.
// Used by the reconcile-prices cron (future task).

import { bizDaysBetween } from '@/lib/portfolio/business-days';

export interface ReconcileInput {
  sellFundCode: string;
  buyFundCode: string;
  sellDate: string;        // 'YYYY-MM-DD'
  settlementDate: string;  // 'YYYY-MM-DD'
  sellUnits: number;
  sellNav: number;         // exact NAV from getExactNav
  buyNav: number;          // exact NAV from getExactNav
  holidays: Set<string>;   // for bizDaysBetween
}

export interface ReconcileResult {
  sellNavTotal: number;    // sellUnits × sellNav
  buyNavTotal: number;     // same as sellNavTotal (no fee model this phase)
  buyUnits: number;        // buyNavTotal / buyNav
  cashDragDays: number;    // bizDaysBetween(sellDate, settlementDate)
}

export function reconcileSwitch(input: ReconcileInput): ReconcileResult {
  const { sellFundCode: _sell, buyFundCode: _buy, sellDate, settlementDate, sellUnits, sellNav, buyNav, holidays } = input;

  // Guard: settlementDate must not precede sellDate
  if (settlementDate < sellDate) {
    throw new Error(
      `reconcileSwitch: settlementDate ${settlementDate} is before sellDate ${sellDate}`,
    );
  }

  // Guard: zero/negative values are invalid
  if (sellUnits <= 0) {
    throw new Error(`reconcileSwitch: sellUnits must be > 0, got ${sellUnits}`);
  }
  if (sellNav <= 0) {
    throw new Error(`reconcileSwitch: sellNav must be > 0, got ${sellNav}`);
  }
  if (buyNav <= 0) {
    throw new Error(`reconcileSwitch: buyNav must be > 0, got ${buyNav}`);
  }

  const sellNavTotal = sellUnits * sellNav;
  const buyNavTotal = sellNavTotal; // no fee model this phase
  const buyUnits = buyNavTotal / buyNav;
  const cashDragDays = bizDaysBetween(sellDate, settlementDate, holidays);

  return { sellNavTotal, buyNavTotal, buyUnits, cashDragDays };
}
