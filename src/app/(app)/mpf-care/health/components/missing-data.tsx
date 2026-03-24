import type { DayCoverage } from "@/lib/mpf/health";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar } from "lucide-react";

function coverageLevel(day: DayCoverage): string {
  if (day.isWeekend) return "bg-zinc-800";
  const pct = day.expectedCount > 0 ? day.fundCount / day.expectedCount : 0;
  if (pct >= 1) return "bg-emerald-500";
  if (pct >= 0.8) return "bg-yellow-500";
  if (day.fundCount === 0) return "bg-zinc-700";
  return "bg-red-500";
}

export function MissingData({ data }: { data: DayCoverage[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Calendar className="h-4 w-4" /> Data Coverage (30 days)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-1">
          {data.map((day) => (
            <div
              key={day.date}
              className={`h-6 w-6 rounded-sm ${coverageLevel(day)}`}
              title={`${day.date}: ${day.fundCount}/${day.expectedCount} funds${day.isWeekend ? " (weekend)" : ""}`}
            />
          ))}
        </div>
        <div className="flex gap-4 mt-3 text-xs text-zinc-500">
          <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-emerald-500 inline-block" /> Complete</span>
          <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-yellow-500 inline-block" /> Partial</span>
          <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-red-500 inline-block" /> Missing</span>
          <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-zinc-800 inline-block" /> Weekend</span>
        </div>
      </CardContent>
    </Card>
  );
}
