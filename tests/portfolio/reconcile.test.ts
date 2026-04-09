import { describe, it, expect } from 'vitest';
import { reconcileSwitch, ReconcileInput } from '@/lib/portfolio/reconcile';

const holidays = new Set(['2026-01-01', '2026-02-17', '2026-02-18', '2026-02-19']);

describe('reconcileSwitch', () => {
  it('happy path: correct sell total, buy units, and cash drag', () => {
    const input: ReconcileInput = {
      sellFundCode: 'FUND_A',
      buyFundCode: 'FUND_B',
      sellDate: '2026-04-07',       // Tuesday
      settlementDate: '2026-04-10', // Friday — 3 biz days later
      sellUnits: 1000,
      sellNav: 12.5,
      buyNav: 8.0,
      holidays,
    };
    const result = reconcileSwitch(input);
    expect(result.sellNavTotal).toBe(12500);
    expect(result.buyNavTotal).toBe(12500);
    expect(result.buyUnits).toBe(1562.5);
    expect(result.cashDragDays).toBe(3);
  });

  it('same-day sell and settlement: cash drag = 0, units correct', () => {
    const input: ReconcileInput = {
      sellFundCode: 'FUND_A',
      buyFundCode: 'FUND_B',
      sellDate: '2026-04-09',
      settlementDate: '2026-04-09',
      sellUnits: 500,
      sellNav: 10.0,
      buyNav: 5.0,
      holidays,
    };
    const result = reconcileSwitch(input);
    expect(result.cashDragDays).toBe(0);
    expect(result.sellNavTotal).toBe(5000);
    expect(result.buyNavTotal).toBe(5000);
    expect(result.buyUnits).toBe(1000);
  });

  it('throws when sellUnits is zero', () => {
    const input: ReconcileInput = {
      sellFundCode: 'FUND_A',
      buyFundCode: 'FUND_B',
      sellDate: '2026-04-09',
      settlementDate: '2026-04-10',
      sellUnits: 0,
      sellNav: 12.5,
      buyNav: 8.0,
      holidays,
    };
    expect(() => reconcileSwitch(input)).toThrow(/sellUnits/);
  });

  it('throws when sellNav is zero', () => {
    const input: ReconcileInput = {
      sellFundCode: 'FUND_A',
      buyFundCode: 'FUND_B',
      sellDate: '2026-04-09',
      settlementDate: '2026-04-10',
      sellUnits: 1000,
      sellNav: 0,
      buyNav: 8.0,
      holidays,
    };
    expect(() => reconcileSwitch(input)).toThrow(/sellNav/);
  });

  it('throws when buyNav is zero', () => {
    const input: ReconcileInput = {
      sellFundCode: 'FUND_A',
      buyFundCode: 'FUND_B',
      sellDate: '2026-04-09',
      settlementDate: '2026-04-10',
      sellUnits: 1000,
      sellNav: 12.5,
      buyNav: 0,
      holidays,
    };
    expect(() => reconcileSwitch(input)).toThrow(/buyNav/);
  });

  it('throws when settlementDate is before sellDate', () => {
    const input: ReconcileInput = {
      sellFundCode: 'FUND_A',
      buyFundCode: 'FUND_B',
      sellDate: '2026-04-10',
      settlementDate: '2026-04-07',
      sellUnits: 1000,
      sellNav: 12.5,
      buyNav: 8.0,
      holidays,
    };
    expect(() => reconcileSwitch(input)).toThrow(/settlementDate/);
  });
});
