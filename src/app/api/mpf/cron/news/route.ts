import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchNews } from "@/lib/mpf/scrapers/news-collector";
import { evaluateAndRebalance } from "@/lib/mpf/rebalancer";
import { sendDiscordAlert, sanitizeError, COLORS } from "@/lib/discord";
import { getConsecutiveFailures } from "@/lib/mpf/health";

export const maxDuration = 120;

const GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";
const MODEL = "google/gemini-2.0-flash";

function gatewayHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.AI_GATEWAY_API_KEY}`,
  };
}

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "No AI_GATEWAY_API_KEY" }, { status: 500 });

  const t0 = Date.now();
  const supabase = createAdminClient();
  let fetched = 0, classified = 0, highImpact = 0, rebResult = "pending";

  try {
  // STEP 1: FETCH NEWS from Google News RSS
  try {
    fetched = await fetchNews();
    console.log(`[news-cron] Fetched ${fetched} new articles`);
  } catch (fetchErr) {
    console.error("[news-cron] fetchNews failed:", fetchErr);
  }

  // STEP 2: CLASSIFY unclassified articles
  try {
    const { data: articles, error: articlesErr } = await supabase.from("mpf_news").select("id, headline")
      .eq("impact_tags", "{}").order("published_at", { ascending: false }).limit(5);
    if (articlesErr) console.error("[news-cron] articles query failed:", articlesErr);
    for (const a of articles || []) {
      try {
        const r = await fetch(GATEWAY_URL, {
          method: "POST",
          headers: gatewayHeaders(),
          body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: `Classify: "${a.headline}". Return JSON: {"sentiment":"positive/negative/neutral","category":"markets/geopolitical/policy/macro","region":"global/asia/hk/china","impact_tags":[],"is_high_impact":false}. Tags from: hk_equity,asia_equity,us_equity,eu_equity,global_equity,bond,fx,rates,china,green_esg. is_high_impact=true for war/sanctions/central bank/crisis.` }], temperature: 0.1 }),
          signal: AbortSignal.timeout(10000),
        });
        const d = await r.json();
        const m = (d.choices?.[0]?.message?.content || "").match(/\{[\s\S]*?\}/);
        if (m) {
          const p = JSON.parse(m[0]);
          const { error: classifyErr } = await supabase.from("mpf_news").update({ sentiment: p.sentiment||"neutral", category: p.category||"markets", region: p.region||"global", impact_tags: p.impact_tags||[], is_high_impact: !!p.is_high_impact }).eq("id", a.id);
          if (classifyErr) console.error("[cron/news] Failed to update classification for article:", classifyErr);
          classified++; if (p.is_high_impact) highImpact++;
        }
      } catch { /* skip single article */ }
    }
  } catch { /* skip classification step */ }

  // STEP 2.5: CORRELATE news to funds via impact_tags → fund code mapping
  try {
    const { data: uncorrelated } = await supabase
      .from("mpf_news")
      .select("id, impact_tags")
      .not("impact_tags", "eq", "{}")
      .gte("published_at", new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
      .limit(20);

    const { IMPACT_TAG_TO_FUNDS } = await import("@/lib/mpf/constants");
    const { data: allFunds, error: fundsErr } = await supabase.from("mpf_funds").select("id, fund_code").eq("is_active", true);
    if (fundsErr) console.error("[news-cron] allFunds query failed:", fundsErr);
    const codeToId = new Map((allFunds || []).map(f => [f.fund_code, f.id]));

    for (const article of uncorrelated || []) {
      const fundCodes = new Set<string>();
      for (const tag of article.impact_tags || []) {
        for (const code of IMPACT_TAG_TO_FUNDS[tag] || []) {
          fundCodes.add(code);
        }
      }

      for (const code of fundCodes) {
        const fundId = codeToId.get(code);
        if (!fundId) continue;

        // Upsert to avoid duplicates
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { error: _upsertErr } = await supabase.from("mpf_fund_news").upsert(
          { fund_id: fundId, news_id: article.id, impact_note: (article.impact_tags || []).join(", ") },
          { onConflict: "fund_id,news_id", ignoreDuplicates: true }
        );
      }
    }
  } catch (corrErr) {
    console.error("[news-cron] Correlation step failed:", corrErr);
  }

  // STEP 3: REBALANCE — only if high-impact news found (saves time on most runs)
  if (highImpact > 0) {
    try {
      const result = await evaluateAndRebalance(highImpact);
      rebResult = result.rebalanced ? `rebalanced: ${result.reason}` : result.reason;
    } catch (e) { rebResult = `error: ${e instanceof Error ? e.message : "unknown"}`; }
  } else {
    rebResult = "skipped — no high-impact news";
  }

  const { error: runLogErr } = await supabase.from("scraper_runs").insert({ scraper_name: "news_pipeline", status: "success", records_processed: fetched + classified, duration_ms: Date.now() - t0 });
  if (runLogErr) console.error("[cron/news] Failed to log success run:", runLogErr);
  return NextResponse.json({ ok: true, fetched, classified, highImpact, rebalance: rebResult, ms: Date.now() - t0 });
  } catch (error) {
    const { error: failLogErr } = await supabase
      .from("scraper_runs")
      .insert({
        scraper_name: "news_pipeline",
        status: "failed",
        error_message: error instanceof Error ? error.message : "Unknown error",
        duration_ms: Date.now() - t0,
      });
    if (failLogErr) console.error("[cron/news] Failed to log error run:", failLogErr);

    const failures = await getConsecutiveFailures(supabase, "news_pipeline");
    const isEscalated = failures >= 2;
    await sendDiscordAlert({
      title: `${isEscalated ? "\ud83d\udd34" : "\u274c"} MPF Care \u2014 News Pipeline Failed`,
      description: [
        `**Error:** ${sanitizeError(error)}`,
        `**Consecutive failures:** ${failures}`,
        `**Duration:** ${Date.now() - t0}ms`,
      ].join("\n"),
      color: COLORS.red,
    });

    return NextResponse.json({ error: "News pipeline failed" }, { status: 500 });
  }
}
