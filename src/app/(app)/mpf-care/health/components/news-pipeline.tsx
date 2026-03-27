import type { NewsPipelineDay } from "@/lib/mpf/health";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Newspaper } from "lucide-react";

export function NewsPipeline({ data }: { data: NewsPipelineDay[] }) {
  const maxTotal = Math.max(...data.map((d) => d.total), 1);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Newspaper className="h-4 w-4" /> News Pipeline (7 days)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-sm text-zinc-300">No news data in the last 7 days</p>
        ) : (
          <div className="space-y-2">
            {data.map((day) => (
              <div key={day.date} className="flex items-center gap-3">
                <span className="text-xs text-zinc-300 w-16 shrink-0">
                  {new Date(day.date).toLocaleDateString("en-US", { weekday: "short", day: "numeric" })}
                </span>
                <div className="flex-1 h-5 bg-zinc-800 rounded-sm overflow-hidden relative">
                  <div
                    className="h-full bg-zinc-600 absolute left-0"
                    style={{ width: `${(day.total / maxTotal) * 100}%`, zIndex: 0 }}
                  />
                  <div
                    className="h-full bg-emerald-600 absolute left-0"
                    style={{ width: `${(day.classified / maxTotal) * 100}%`, zIndex: 1 }}
                  />
                </div>
                <span className="text-xs text-zinc-400 w-20 text-right shrink-0">
                  {day.classified}/{day.total} classified
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
