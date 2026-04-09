// src/lib/portfolio/business-days.ts — Shared business-day utilities
// MPF and ILAS trackers both import from here. loadHKHolidays lives in the
// MPF tracker (owns the Supabase cache) and is re-exported here for convenience.

// Re-export loadHKHolidays from its canonical home (MPF tracker owns the cache).
export { loadHKHolidays } from '@/lib/mpf/portfolio-tracker';

export function isWorkingDay(dateStr: string, holidays: Set<string>): boolean {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = d.getUTCDay();
  if (day === 0 || day === 6) return false;
  return !holidays.has(dateStr);
}

export function addWorkingDays(
  startDate: string,
  days: number,
  holidays: Set<string>,
): string {
  let current = startDate;
  let added = 0;
  while (added < days) {
    const d = new Date(current + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 1);
    current = d.toISOString().split('T')[0];
    if (isWorkingDay(current, holidays)) added++;
  }
  return current;
}

export function bizDaysBetween(
  fromDate: string,
  toDate: string,
  holidays: Set<string>,
): number {
  if (fromDate === toDate) return 0;
  if (fromDate > toDate) {
    throw new Error(`bizDaysBetween: fromDate ${fromDate} > toDate ${toDate}`);
  }
  let count = 0;
  let cursor = fromDate;
  while (cursor < toDate) {
    const d = new Date(cursor + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 1);
    cursor = d.toISOString().split('T')[0];
    if (isWorkingDay(cursor, holidays)) count++;
  }
  return count;
}
