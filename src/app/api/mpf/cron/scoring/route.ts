import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { scoreDecision, getFundReturnsForPeriod, computePortfolioReturn } from "@/lib/mpf/scorer";
import { sendDiscordAlert, COLORS } from "@/lib/discord";
import type { ScorePeriod } from "@/lib/mpf/types";

export const maxDuration = 120;

const PERIOD_DAYS: Record<ScorePeriod, number> = { "7d": 7, "30d": 30, "90d": 90 };
const MAX_SCORES_PER_RUN = 10;

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const startTime = Date.now();
  let scored = 0;

  try {
    // Find unscored live decisions (prioritized)
    const { data: unscoredLive } = await supabase
      .from("mpf_insights")
      .select("id, content_en, created_at, type")
      .eq("type", "rebalance_debate")
      .eq("status", "completed")
      .order("created_at", { ascending: true });

    // Find unscored backtest results
    const { data: unscoredBacktest } = await supabase
      .from("mpf_backtest_results")
      .select("id, debate_log, allocation, sim_date, rebalance_triggered")
      .eq("rebalance_triggered", true)
      .order("sim_date", { ascending: true })
      .limit(50);

    // Determine which need scoring
    const toScore: { type: "live" | "backtest"; id: string; debateLog: string; allocation: any; decisionDate: string }[] = [];

    for (const insight of unscoredLive || []) {
      // Check which periods are unscored
      for (const period of ["7d", "30d", "90d"] as ScorePeriod[]) {
        const daysSince = (Date.now() - new Date(insight.created_at).getTime()) / (1000 * 60 * 60 * 24);
        if (daysSince < PERIOD_DAYS[period]) continue;

        const { data: existing } = await supabase
          .from("mpf_rebalance_scores")
          .select("id")
          .eq("insight_id", insight.id)
          .eq("score_period", period)
          .single();

        if (!existing) {
          // Extract allocation from debate log (format: "- AIA-XXX: 50% — reasoning")
          const allocMatch = insight.content_en?.match(/AIA-\w+:\s*\d+%/g);
          const allocation = allocMatch?.map((m: string) => {
            const [code, weight] = m.split(/:\s*/);
            return { code: code.trim(), weight: parseInt(weight) };
          }) || [];

          toScore.push({
            type: "live",
            id: insight.id,
            debateLog: insight.content_en || "",
            allocation,
            decisionDate: insight.created_at,
          });
          break; // Score earliest eligible period first
        }
      }
    }

    // Add backtest results (lower priority)
    for (const result of unscoredBacktest || []) {
      if (toScore.length >= MAX_SCORES_PER_RUN) break;

      const { data: existing } = await supabase
        .from("mpf_rebalance_scores")
        .select("id")
        .eq("backtest_result_id", result.id)
        .limit(1)
        .single();

      if (!existing) {
        toScore.push({
          type: "backtest",
          id: result.id,
          debateLog: result.debate_log || "",
          allocation: result.allocation || [],
          decisionDate: result.sim_date,
        });
      }
    }

    // Score up to MAX_SCORES_PER_RUN
    for (const item of toScore.slice(0, MAX_SCORES_PER_RUN)) {
      // Determine scoring period
      const period: ScorePeriod = item.type === "backtest" ? "30d" : "7d"; // Backtest scores at 30d, live starts at 7d
      const days = PERIOD_DAYS[period];

      const decisionDate = new Date(item.decisionDate).toISOString().split("T")[0];
      const endDate = new Date(new Date(item.decisionDate).getTime() + days * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

      // Get actual fund returns for the period
      const fundReturns = await getFundReturnsForPeriod(decisionDate, endDate);
      const portfolioReturn = computePortfolioReturn(item.allocation, fundReturns);

      // Baseline: "do nothing" — get the PREVIOUS allocation before this rebalance
      let baselineReturn = 0;
      if (item.type === "live") {
        // Find the previous rebalance decision to get the old allocation
        const { data: prevInsight } = await supabase
          .from("mpf_insights")
          .select("content_en")
          .or("type.eq.alert,type.eq.rebalance_debate")
          .lt("created_at", item.decisionDate)
          .order("created_at", { ascending: false })
          .limit(1)
          .single();

        if (prevInsight?.content_en) {
          const prevAllocMatch = prevInsight.content_en.match(/AIA-\w+:\s*\d+%/g);
          const prevAllocation = prevAllocMatch?.map((m: string) => {
            const [code, weight] = m.split(/:\s*/);
            return { code: code.trim(), weight: parseInt(weight) };
          }) || [];
          if (prevAllocation.length > 0) {
            baselineReturn = computePortfolioReturn(prevAllocation, fundReturns);
          }
        }
      }
      // For backtest: baseline is the previous week's allocation (stored in previous result)
      if (baselineReturn === 0) {
        // Fallback: equal-weight average of all fund returns
        const vals = Object.values(fundReturns);
        baselineReturn = vals.length > 0 ? vals.reduce((s, r) => s + r, 0) / vals.length : 0;
      }

      const scoreResult = await scoreDecision({
        debateLog: item.debateLog,
        allocation: item.allocation,
        actualReturns: fundReturns,
        portfolioReturn,
        baselineReturn,
        period,
      });

      if (scoreResult) {
        await supabase.from("mpf_rebalance_scores").insert({
          insight_id: item.type === "live" ? item.id : null,
          backtest_result_id: item.type === "backtest" ? item.id : null,
          score_period: period,
          claims: scoreResult.claims,
          win_rate: scoreResult.win_rate,
          reasoning_quality: scoreResult.reasoning_quality,
          lessons: scoreResult.lessons,
          actual_return_pct: portfolioReturn,
          baseline_return_pct: baselineReturn,
        });
        scored++;
      }
    }

    // Discord summary
    if (scored > 0) {
      await sendDiscordAlert({
        title: "📊 MPF Care — Scoring Complete",
        description: `Scored **${scored}** rebalance decisions (${toScore.filter(t => t.type === "live").length} live, ${toScore.filter(t => t.type === "backtest").length} backtest)`,
        color: COLORS.green,
      });
    }

    return NextResponse.json({ ok: true, scored, ms: Date.now() - startTime });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown", ms: Date.now() - startTime }, { status: 500 });
  }
}
