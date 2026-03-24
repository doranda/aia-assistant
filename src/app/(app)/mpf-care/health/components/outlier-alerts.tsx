import type { OutlierFund } from "@/lib/mpf/health";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, CheckCircle } from "lucide-react";

export function OutlierAlerts({ data }: { data: OutlierFund[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" /> Outlier Alerts (&gt;3%)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-emerald-400">
            <CheckCircle className="h-4 w-4" /> No outliers detected
          </div>
        ) : (
          <div className="space-y-2">
            {data.map((fund) => (
              <div
                key={fund.fund_code}
                className="flex items-center justify-between rounded-lg bg-red-500/10 px-3 py-2"
              >
                <div>
                  <span className="text-sm font-medium">{fund.fund_code}</span>
                  <span className="text-xs text-zinc-500 ml-2">{fund.name_en}</span>
                </div>
                <span
                  className={`text-sm font-mono ${fund.daily_change_pct > 0 ? "text-emerald-400" : "text-red-400"}`}
                >
                  {fund.daily_change_pct > 0 ? "+" : ""}
                  {fund.daily_change_pct.toFixed(2)}%
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
