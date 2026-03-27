import type { FreshnessStatus } from "@/lib/mpf/health";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock } from "lucide-react";

const levelColors = {
  green: "text-emerald-400",
  yellow: "text-yellow-400",
  red: "text-red-400",
};

const levelBg = {
  green: "bg-emerald-500/10",
  yellow: "bg-yellow-500/10",
  red: "bg-red-500/10",
};

export function DataFreshness({ data }: { data: FreshnessStatus[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Clock className="h-4 w-4" /> Data Freshness
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {data.map((item) => (
          <div
            key={item.label}
            className={`flex items-center justify-between rounded-lg px-3 py-2 ${levelBg[item.level]}`}
          >
            <span className="text-sm font-medium">{item.label}</span>
            <span className={`text-sm ${levelColors[item.level]}`}>
              {item.hoursAgo === null
                ? "No data"
                : item.hoursAgo < 1
                  ? "< 1 hour ago"
                  : item.hoursAgo < 24
                    ? `${item.hoursAgo}h ago`
                    : `${Math.round(item.hoursAgo / 24)}d ago`}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
