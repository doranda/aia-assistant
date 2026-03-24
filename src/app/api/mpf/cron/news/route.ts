import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendDiscordAlert, sanitizeError, COLORS } from "@/lib/discord";
import { getConsecutiveFailures } from "@/lib/mpf/health";

export const maxDuration = 60;

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
  let classified = 0, highImpact = 0, rebResult = "pending";

  try {
  // CLASSIFY
  try {
    const { data: articles } = await supabase.from("mpf_news").select("id, headline")
      .eq("impact_tags", "{}").order("published_at", { ascending: false }).limit(5);
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
          await supabase.from("mpf_news").update({ sentiment: p.sentiment||"neutral", category: p.category||"markets", region: p.region||"global", impact_tags: p.impact_tags||[], is_high_impact: !!p.is_high_impact }).eq("id", a.id);
          classified++; if (p.is_high_impact) highImpact++;
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }

  // REBALANCE CHECK
  try {
    // Rate limit: skip if rebalanced within 7 days (unless high-impact news)
    if (highImpact === 0) {
      const { data: lastRebs } = await supabase.from("mpf_insights").select("created_at")
        .eq("trigger", "portfolio_rebalance").order("created_at", { ascending: false }).limit(1);
      const lastReb = lastRebs?.[0];
      if (lastReb && (Date.now() - new Date(lastReb.created_at).getTime()) < 7 * 86400000) {
        rebResult = "skipped — last rebalance < 7 days ago";
        // Skip to end
        await supabase.from("scraper_runs").insert({ scraper_name: "news_pipeline", status: "success", records_processed: classified, duration_ms: Date.now() - t0 });
        return NextResponse.json({ ok: true, classified, highImpact, rebalance: rebResult, ms: Date.now() - t0 });
      }
    }

    const { data: pf } = await supabase.from("mpf_reference_portfolio").select("fund_id, weight");
    const { data: funds } = await supabase.from("mpf_funds").select("id, fund_code, name_en");
    const { data: prices } = await supabase.from("mpf_prices").select("fund_id, daily_change_pct").order("date", { ascending: false }).limit(50);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fm = new Map((funds||[]).map((f:any)=>[f.id,f]));
    const pm = new Map<string,number>();
    for (const p of prices||[]) { if (!pm.has(p.fund_id)) pm.set(p.fund_id, p.daily_change_pct||0); }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cur = (pf||[]).map((h:any)=>{ const f=fm.get(h.fund_id); return `${f?.fund_code}:${h.weight}%`; }).join(", ");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const perf = (funds||[]).filter((f:any)=>pm.has(f.id)).map((f:any)=>`${f.fund_code}:${(pm.get(f.id)||0).toFixed(1)}%`).join(", ");

    const { data: hiNews } = await supabase.from("mpf_news").select("headline, sentiment")
      .eq("is_high_impact", true).gte("published_at", new Date(Date.now() - 86400000).toISOString());

    const r = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: gatewayHeaders(),
      body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: `MPF portfolio manager for AIA Hong Kong. Current portfolio: ${cur}. Recent high-impact news: ${(hiNews||[]).map(n=>`[${n.sentiment}] ${n.headline}`).join("; ")||"None"}. Fund performance: ${perf}. Should this portfolio be rebalanced? Rules: 1-5 funds, weights in 10% increments totaling 100%. Available: AIA-AEF,AIA-EEF,AIA-GCF,AIA-NAF,AIA-GRF,AIA-AMI,AIA-EAI,AIA-HCI,AIA-WIF,AIA-GRW,AIA-BAL,AIA-CST,AIA-CHD,AIA-MCF,AIA-ABF,AIA-GBF,AIA-CON. Return ONLY JSON: {"should_rebalance":false,"reason":"why","new_portfolio":[{"fund_code":"AIA-XXX","weight":30,"rationale":"why"}]}` }], temperature: 0.2 }),
      signal: AbortSignal.timeout(15000),
    });
    const d = await r.json();
    const jm = (d.choices?.[0]?.message?.content||"").match(/\{[\s\S]*\}/);
    if (jm) {
      const dec = JSON.parse(jm[0]);
      if (dec.should_rebalance && Array.isArray(dec.new_portfolio)) {
        const np = dec.new_portfolio;
        const tw = np.reduce((s:number,p:{weight:number})=>s+p.weight,0);
        if (np.length>=1 && np.length<=5 && tw===100) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const c2i = new Map((funds||[]).map((f:any)=>[f.fund_code,f.id]));

          // SNAPSHOT current portfolio into rebalance_history BEFORE deleting
          try {
            const { data: currentPf } = await supabase.from("mpf_reference_portfolio").select("fund_id, weight, note");
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const i2c = new Map((funds||[]).map((f:any)=>[f.id,f.fund_code]));
            const portfolioSnapshot = (currentPf||[]).map((row:{fund_id:string;weight:number;note:string|null})=>({
              fund_code: i2c.get(row.fund_id) ?? row.fund_id,
              fund_id: row.fund_id,
              weight: row.weight,
              note: row.note,
            }));
            if (portfolioSnapshot.length > 0) {
              await supabase.from("mpf_rebalance_history").insert({
                trigger: "portfolio_rebalance",
                reason: dec.reason,
                portfolio: portfolioSnapshot,
              });
            }
          } catch (snapErr) { console.error("[news-cron] rebalance snapshot failed:", snapErr); }

          await supabase.from("mpf_reference_portfolio").delete().neq("fund_id","00000000-0000-0000-0000-000000000000");
          for (const p of np) { const fid=c2i.get(p.fund_code); if(fid) await supabase.from("mpf_reference_portfolio").insert({fund_id:fid,weight:p.weight,note:p.rationale,updated_by:"auto"}); }
          await supabase.from("mpf_insights").insert({type:"alert",trigger:"portfolio_rebalance",status:"completed",content_en:`Rebalanced: ${dec.reason}\n${np.map((p:{fund_code:string;weight:number;rationale:string})=>`${p.fund_code}:${p.weight}% - ${p.rationale}`).join("\n")}`});
          rebResult = `rebalanced: ${dec.reason}`;
        } else { rebResult = `invalid: ${np.length} funds, ${tw}%`; }
      } else { rebResult = dec.reason || "no change needed"; }
    } else { rebResult = `no json. status:${r.status} content:${(d.choices?.[0]?.message?.content||d.error?.message||"empty").slice(0,200)}`; }
  } catch (e) { rebResult = `error: ${e instanceof Error ? e.message : "unknown"}`; }

  await supabase.from("scraper_runs").insert({ scraper_name: "news_pipeline", status: "success", records_processed: classified, duration_ms: Date.now() - t0 });
  return NextResponse.json({ ok: true, classified, highImpact, rebalance: rebResult, ms: Date.now() - t0 });
  } catch (error) {
    await supabase
      .from("scraper_runs")
      .insert({
        scraper_name: "news_pipeline",
        status: "failed",
        error_message: error instanceof Error ? error.message : "Unknown error",
        duration_ms: Date.now() - t0,
      });

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
