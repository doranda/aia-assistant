// src/app/api/cron/strategy-review/route.ts
// Weekly strategy review — runs Monday 10:00 UTC (18:00 HKT), after Sunday scoring.
// Aggregates MPF + ILAS rebalance performance, win rates, claim accuracy,
// and behavioral drift into a single Discord report for the team.

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendDiscordAlert, COLORS } from "@/lib/discord";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  try {
    // ===== 1. MPF DECISIONS THIS WEEK =====
    const { data: mpfDebates } = await supabase
      .from("mpf_insights")
      .select("id, content_en, content_zh, created_at, model, status")
      .eq("type", "rebalance_debate")
      .gte("created_at", weekAgo)
      .order("created_at", { ascending: false });

    // ===== 2. ILAS DECISIONS THIS WEEK =====
    const { data: ilasDebates } = await supabase
      .from("ilas_insights")
      .select("id, content_en, created_at, model, status, trigger")
      .eq("type", "rebalance_debate")
      .gte("created_at", weekAgo)
      .order("created_at", { ascending: false });

    // ===== 3. MPF SCORES (all time, for trend) =====
    const { data: allMpfScores } = await supabase
      .from("mpf_rebalance_scores")
      .select("win_rate, reasoning_quality, actual_return_pct, baseline_return_pct, lessons, claims, scored_at, score_period")
      .not("insight_id", "is", null)
      .order("scored_at", { ascending: false })
      .limit(20);

    // ===== 4. ILAS SCORES (all time) =====
    const { data: allIlasScores } = await supabase
      .from("ilas_rebalance_scores")
      .select("win_rate, reasoning_quality, actual_return_pct, baseline_return_pct, lessons, claims, scored_at, score_period")
      .not("insight_id", "is", null)
      .order("scored_at", { ascending: false })
      .limit(20);

    // ===== 5. SWITCH STATUS =====
    const { data: mpfSwitches } = await supabase
      .from("mpf_pending_switches")
      .select("id, status, decision_date, settlement_date, executed_at")
      .gte("created_at", monthAgo)
      .order("created_at", { ascending: false })
      .limit(10);

    const { data: ilasSwitches } = await supabase
      .from("ilas_portfolio_orders")
      .select("id, status, decision_date, settlement_date, executed_at, portfolio_type")
      .gte("created_at", monthAgo)
      .order("created_at", { ascending: false })
      .limit(10);

    // ===== 6. CURRENT PORTFOLIO POSITION =====
    const { data: mpfPortfolio } = await supabase
      .from("mpf_reference_portfolio")
      .select("fund_id, weight");

    const { data: mpfFunds } = await supabase
      .from("mpf_funds")
      .select("id, fund_code, category")
      .eq("is_active", true);

    const fundMap = new Map((mpfFunds || []).map(f => [f.id, f]));
    const defensiveCodes = new Set(["AIA-CON", "AIA-ABF", "AIA-GBF", "AIA-GPF", "AIA-CST", "AIA-65P"]);

    const mpfHoldings = (mpfPortfolio || []).map(p => {
      const fund = fundMap.get(p.fund_id);
      return { code: fund?.fund_code || "", weight: p.weight, category: fund?.category || "" };
    });

    const mpfEquityPct = mpfHoldings
      .filter(h => !defensiveCodes.has(h.code))
      .reduce((sum, h) => sum + h.weight, 0);
    const mpfDefensivePct = 100 - mpfEquityPct;

    // ===== COMPUTE METRICS =====
    const allScores = [...(allMpfScores || []), ...(allIlasScores || [])];
    const recentScores = allScores.filter(s => new Date(s.scored_at) >= new Date(weekAgo));

    // Win rate trend
    const totalScored = allScores.length;
    const soundCount = allScores.filter(s => s.reasoning_quality === "sound").length;
    const luckyCount = allScores.filter(s => s.reasoning_quality === "lucky").length;
    const wrongCount = allScores.filter(s => s.reasoning_quality === "wrong").length;
    const inconclusiveCount = allScores.filter(s => s.reasoning_quality === "inconclusive").length;

    const avgWinRate = totalScored > 0
      ? allScores.reduce((sum, s) => sum + (s.win_rate || 0), 0) / totalScored
      : 0;

    // Alpha trend (portfolio vs baseline)
    const alphaValues = allScores
      .filter(s => s.actual_return_pct != null && s.baseline_return_pct != null)
      .map(s => (s.actual_return_pct || 0) - (s.baseline_return_pct || 0));
    const avgAlpha = alphaValues.length > 0
      ? alphaValues.reduce((s, v) => s + v, 0) / alphaValues.length
      : 0;

    // Claim accuracy (from all scores)
    let totalClaims = 0;
    let correctClaims = 0;
    let incorrectClaims = 0;
    for (const score of allScores) {
      if (Array.isArray(score.claims)) {
        for (const claim of score.claims) {
          totalClaims++;
          if (claim.outcome === "correct") correctClaims++;
          if (claim.outcome === "incorrect") incorrectClaims++;
        }
      }
    }
    const claimAccuracy = totalClaims > 0 ? correctClaims / totalClaims : 0;

    // Top lessons (deduplicated, last 5)
    const allLessons: string[] = [];
    for (const score of allScores.slice(0, 10)) {
      if (Array.isArray(score.lessons)) {
        for (const lesson of score.lessons) {
          if (lesson && !allLessons.includes(lesson)) allLessons.push(lesson);
        }
      }
    }

    // Switch pipeline health
    const mpfPending = (mpfSwitches || []).filter(s => s.status === "pending").length;
    const mpfExecuted = (mpfSwitches || []).filter(s => s.status === "executed").length;
    const mpfSettled = (mpfSwitches || []).filter(s => s.status === "settled").length;
    const ilasPending = (ilasSwitches || []).filter(s => s.status === "pending").length;
    const ilasExecuted = (ilasSwitches || []).filter(s => s.status === "executed").length;
    const ilasSettled = (ilasSwitches || []).filter(s => s.status === "settled").length;

    // ===== DETERMINE HEALTH COLOR =====
    let color: number = COLORS.green;
    let verdict = "✅ On Track";

    if (totalScored === 0) {
      color = COLORS.yellow;
      verdict = "⏳ Insufficient Data";
    } else if (wrongCount > soundCount) {
      color = COLORS.red;
      verdict = "🔴 Strategy Underperforming";
    } else if (avgAlpha < -2) {
      color = COLORS.red;
      verdict = "🔴 Negative Alpha Trend";
    } else if (avgWinRate < 0.4) {
      color = COLORS.yellow;
      verdict = "⚠️ Low Win Rate";
    } else if (claimAccuracy < 0.4 && totalClaims > 3) {
      color = COLORS.yellow;
      verdict = "⚠️ Low Claim Accuracy";
    }

    // ===== BUILD REPORT =====
    const weekLabel = `${new Date(weekAgo).toISOString().split("T")[0]} → ${now.toISOString().split("T")[0]}`;

    const fields: { name: string; value: string; inline?: boolean }[] = [
      {
        name: "📅 Period",
        value: weekLabel,
        inline: true,
      },
      {
        name: "🎯 Verdict",
        value: verdict,
        inline: true,
      },
      {
        name: "📊 Decisions This Week",
        value: [
          `MPF: **${(mpfDebates || []).length}** debates (${(mpfDebates || []).filter(d => d.status === "completed").length} completed)`,
          `ILAS: **${(ilasDebates || []).length}** debates`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "🏆 Performance (All Time)",
        value: [
          `Win rate: **${(avgWinRate * 100).toFixed(0)}%** (${totalScored} scored decisions)`,
          `Avg alpha: **${avgAlpha > 0 ? "+" : ""}${avgAlpha.toFixed(2)}%** vs hold-still`,
          `Claim accuracy: **${(claimAccuracy * 100).toFixed(0)}%** (${correctClaims}/${totalClaims} claims correct)`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "🧠 Reasoning Quality",
        value: [
          `Sound: ${soundCount} | Lucky: ${luckyCount} | Wrong: ${wrongCount} | Inconclusive: ${inconclusiveCount}`,
          totalScored > 0
            ? `Ratio: **${((soundCount / totalScored) * 100).toFixed(0)}% sound** decisions`
            : "No scores yet",
        ].join("\n"),
        inline: false,
      },
      {
        name: "⚖️ Current Position (MPF)",
        value: [
          `Defensive: **${mpfDefensivePct}%** | Equity: **${mpfEquityPct}%**`,
          mpfHoldings.filter(h => h.weight > 0).map(h => `${h.code}: ${h.weight}%`).join(", ") || "No holdings",
        ].join("\n"),
        inline: false,
      },
      {
        name: "🔄 Switch Pipeline (30d)",
        value: [
          `MPF: ${mpfPending} pending, ${mpfExecuted} executed, ${mpfSettled} settled`,
          `ILAS: ${ilasPending} pending, ${ilasExecuted} executed, ${ilasSettled} settled`,
        ].join("\n"),
        inline: false,
      },
    ];

    // Add top lessons if available
    if (allLessons.length > 0) {
      fields.push({
        name: "📝 Key Lessons Learned",
        value: allLessons.slice(0, 5).map((l, i) => `${i + 1}. ${l}`).join("\n"),
        inline: false,
      });
    }

    // Add stuck order warning if any
    const stuckOrders = [
      ...(mpfSwitches || []).filter(s => s.status === "pending"),
      ...(ilasSwitches || []).filter(s => s.status === "pending"),
    ];
    if (stuckOrders.length > 0) {
      fields.push({
        name: "⚠️ Stuck Orders",
        value: stuckOrders.map(s => `\`${s.id.slice(0, 8)}\` — pending since ${s.decision_date}`).join("\n"),
        inline: false,
      });
    }

    await sendDiscordAlert({
      title: "📋 Weekly Strategy Review",
      description: `AI rebalancer performance review for the week of ${weekLabel}.`,
      color,
      fields,
      footer: {
        text: `Model: anthropic/claude-sonnet-4.6 | Generated ${now.toISOString().split("T")[0]}`,
      },
    });

    return NextResponse.json({
      ok: true,
      summary: {
        verdict,
        decisions: { mpf: (mpfDebates || []).length, ilas: (ilasDebates || []).length },
        performance: { winRate: avgWinRate, alpha: avgAlpha, claimAccuracy },
        quality: { sound: soundCount, lucky: luckyCount, wrong: wrongCount, inconclusive: inconclusiveCount },
        position: { defensivePct: mpfDefensivePct, equityPct: mpfEquityPct },
        pipeline: { mpf: { pending: mpfPending, executed: mpfExecuted, settled: mpfSettled }, ilas: { pending: ilasPending, executed: ilasExecuted, settled: ilasSettled } },
        lessons: allLessons.slice(0, 5),
      },
    });
  } catch (error) {
    console.error("[cron/strategy-review] error:", error);
    return NextResponse.json({ error: "Strategy review failed" }, { status: 500 });
  }
}
