// src/components/ilas/portfolio-track-record.tsx
// Displays the synthetic portfolio NAV from ilas_portfolio_nav
// Supports both accumulation and distribution portfolio types

import { cn } from "@/lib/utils";

interface IlasNavRecord {
  date: string;
  nav: number;
  daily_return_pct: number | null;
  is_cash: boolean;
}

interface IlasTrackRecordProps {
  navHistory: IlasNavRecord[];
  portfolioType: "accumulation" | "distribution";
  inceptionDate: string | null;
}

function formatReturn(val: number | null): string {
  if (val === null || val === undefined) return "\u2014";
  return `${val > 0 ? "+" : ""}${val.toFixed(2)}%`;
}

function returnColor(val: number | null): string {
  if (val === null || val === undefined) return "text-zinc-400";
  if (val > 0) return "text-emerald-400";
  if (val < 0) return "text-red-400";
  return "text-zinc-300";
}

export function IlasPortfolioTrackRecord({
  navHistory,
  portfolioType,
  inceptionDate,
}: IlasTrackRecordProps) {
  const title =
    portfolioType === "accumulation"
      ? "Accumulation Track Record"
      : "Distribution Track Record";

  const headingId = `ilas-${portfolioType}-track-record-heading`;

  if (navHistory.length === 0) {
    return (
      <section aria-labelledby={headingId} className="mb-8 px-4 sm:px-6">
        <h2
          id={headingId}
          className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-300 mb-2"
        >
          {title}
        </h2>
        <p className="text-[11px] text-zinc-400 font-mono">
          NAV tracking begins on the next working day when the portfolio-nav cron runs.
        </p>
      </section>
    );
  }

  const latest = navHistory[navHistory.length - 1];
  const first = navHistory[0];

  // Daily return (from the latest record)
  const dailyReturn = latest.daily_return_pct;

  // Since inception return
  const sinceInception =
    first.nav > 0 ? ((latest.nav - first.nav) / first.nav) * 100 : null;

  // MTD: first NAV of current month vs latest
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const mtdStart = navHistory.find((n) => n.date >= monthStart);
  const mtdReturn =
    mtdStart && mtdStart !== latest
      ? ((latest.nav - mtdStart.nav) / mtdStart.nav) * 100
      : null;

  // YTD: first NAV of current year vs latest
  const ytdStart = `${now.getFullYear()}-01-01`;
  const ytdFirst = navHistory.find((n) => n.date >= ytdStart);
  const ytdReturn =
    ytdFirst && ytdFirst !== latest
      ? ((latest.nav - ytdFirst.nav) / ytdFirst.nav) * 100
      : null;

  // Days tracking
  const daysTracking = navHistory.length;
  const cashDays = navHistory.filter((n) => n.is_cash).length;

  return (
    <section aria-labelledby={headingId} className="mb-8 px-4 sm:px-6">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
        <h2
          id={headingId}
          className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-300"
        >
          {title}
        </h2>
        {inceptionDate && (
          <span className="text-[10px] font-mono text-zinc-400">
            Tracking since{" "}
            {new Date(inceptionDate).toLocaleDateString("en-HK", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </span>
        )}
      </div>
      <p className="text-[11px] text-zinc-400 mb-6 font-mono">
        Actual tracked NAV — includes T+2 settlement cash drag
      </p>

      {/* NAV + performance tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-lg p-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 mb-1">
            NAV
          </div>
          <div className="text-lg sm:text-xl font-mono font-semibold tabular-nums text-zinc-100">
            {latest.nav.toFixed(4)}
          </div>
          <div className="text-[10px] font-mono text-zinc-400 mt-1">
            {latest.date}
          </div>
        </div>

        <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-lg p-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 mb-1">
            Daily
          </div>
          <div
            className={cn(
              "text-lg sm:text-xl font-mono font-semibold tabular-nums",
              returnColor(dailyReturn)
            )}
          >
            {formatReturn(dailyReturn)}
          </div>
          {latest.is_cash && (
            <div className="text-[10px] font-mono text-amber-400 mt-1">
              In cash (settling)
            </div>
          )}
        </div>

        <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-lg p-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 mb-1">
            MTD
          </div>
          <div
            className={cn(
              "text-lg sm:text-xl font-mono font-semibold tabular-nums",
              returnColor(mtdReturn)
            )}
          >
            {formatReturn(mtdReturn)}
          </div>
        </div>

        <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-lg p-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 mb-1">
            YTD
          </div>
          <div
            className={cn(
              "text-lg sm:text-xl font-mono font-semibold tabular-nums",
              returnColor(ytdReturn)
            )}
          >
            {formatReturn(ytdReturn)}
          </div>
        </div>

        <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-lg p-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 mb-1">
            Since Inception
          </div>
          <div
            className={cn(
              "text-lg sm:text-xl font-mono font-semibold tabular-nums",
              returnColor(sinceInception)
            )}
          >
            {formatReturn(sinceInception)}
          </div>
          <div className="text-[10px] font-mono text-zinc-400 mt-1">
            {daysTracking} day{daysTracking !== 1 ? "s" : ""}
            {cashDays > 0 && ` \u00b7 ${cashDays} in cash`}
          </div>
        </div>
      </div>
    </section>
  );
}
