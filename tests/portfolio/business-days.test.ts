import { describe, it, expect } from 'vitest';
import { isWorkingDay, addWorkingDays, bizDaysBetween } from '@/lib/portfolio/business-days';

const holidays = new Set(['2026-01-01', '2026-02-17', '2026-02-18', '2026-02-19']); // CNY stub

describe('isWorkingDay', () => {
  it('rejects weekends', () => {
    expect(isWorkingDay('2026-04-11', holidays)).toBe(false); // Saturday
    expect(isWorkingDay('2026-04-12', holidays)).toBe(false); // Sunday
  });
  it('rejects holidays', () => {
    expect(isWorkingDay('2026-01-01', holidays)).toBe(false);
  });
  it('accepts regular weekdays', () => {
    expect(isWorkingDay('2026-04-10', holidays)).toBe(true); // Friday
  });
});

describe('addWorkingDays', () => {
  it('adds 1 biz day skipping weekend', () => {
    expect(addWorkingDays('2026-04-10', 1, holidays)).toBe('2026-04-13'); // Fri → Mon
  });
  it('adds 10 biz days across CNY week', () => {
    // Feb 16 Mon + 10 bd, skipping Feb 17-19 (3 holidays) + Feb 21-22 (weekend)
    // Lands on Mar 5: Feb 20,23,24,25,26,27 + Mar 2,3,4,5 = 10 biz days
    expect(addWorkingDays('2026-02-16', 10, holidays)).toBe('2026-03-05');
  });
});

describe('bizDaysBetween', () => {
  it('returns 0 for same day', () => {
    expect(bizDaysBetween('2026-04-10', '2026-04-10', holidays)).toBe(0);
  });
  it('returns 1 for Fri→Mon', () => {
    expect(bizDaysBetween('2026-04-10', '2026-04-13', holidays)).toBe(1);
  });
  it('throws when fromDate > toDate', () => {
    expect(() => bizDaysBetween('2026-04-13', '2026-04-10', holidays)).toThrow();
  });
});
