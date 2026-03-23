import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "No key" }, { status: 500 });

  const t0 = Date.now();
  const supabase = createAdminClient();
  let classified = 0, highImpact = 0, rebResult = "pending";

  // CLASSIFY
  try {
    const { data: articles } = await supabase.from("mpf_news").select("id, headline")
      .eq("impact_tags", "{}").order("published_at", { ascending: false }).limit(5);
    for (const a of articles || []) {
      try {
        const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, "HTTP-Referer": "https://aia-assistant.vercel.app" },
          body: JSON.stringify({ model: "nvidia/nemotron-3-super-120b-a12b:free", messages: [{ role: "user", content: `Classify: "${a.headline}". Return JSON: {"sentiment":"positive/negative/neutral","region":"global/asia/hk/china","impact_tags":[],"is_high_impact":false}` }], temperature: 0.1 }),
          signal: AbortSignal.timeout(10000),
        });
        const d = await r.json();
        const m = (d.choices?.[0]?.message?.content || "").match(/\{[\s\S]*?\}/);
        if (m) {
          const p = JSON.parse(m[0]);
          await supabase.from("mpf_news").update({ sentiment: p.sentiment||"neutral", region: p.region||"global", impact_tags: p.impact_tags||[], is_high_impact: !!p.is_high_impact }).eq("id", a.id);
          classified++; if (p.is_high_impact) highImpact++;
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }

  // REBALANCE
  try {
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

    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, "HTTP-Referer": "https://aia-assistant.vercel.app" },
      body: JSON.stringify({ model: "nvidia/nemotron-3-super-120b-a12b:free", messages: [{ role: "user", content: `MPF portfolio manager. Current: ${cur}. Performance: ${perf}. Should rebalance? 1-5 funds, 10% increments, total 100%. Return ONLY JSON: {"should_rebalance":false,"reason":"why","new_portfolio":[{"fund_code":"AIA-XXX","weight":30,"rationale":"why"}]}` }], temperature: 0.2 }),
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
          await supabase.from("mpf_reference_portfolio").delete().neq("fund_id","00000000-0000-0000-0000-000000000000");
          for (const p of np) { const fid=c2i.get(p.fund_code); if(fid) await supabase.from("mpf_reference_portfolio").insert({fund_id:fid,weight:p.weight,note:p.rationale,updated_by:"auto"}); }
          await supabase.from("mpf_insights").insert({type:"alert",trigger:"portfolio_rebalance",status:"completed",content_en:`Rebalanced: ${dec.reason}\n${np.map((p:{fund_code:string;weight:number;rationale:string})=>`${p.fund_code}:${p.weight}% - ${p.rationale}`).join("\n")}`});
          rebResult = `rebalanced: ${dec.reason}`;
        } else { rebResult = `invalid: ${np.length} funds, ${tw}%`; }
      } else { rebResult = dec.reason || "no change needed"; }
    } else { rebResult = `no json. status:${r.status} content:${(d.choices?.[0]?.message?.content||d.error?.message||"empty").slice(0,200)}`; }
  } catch (e) { rebResult = `error: ${e instanceof Error ? e.message : "unknown"}`; }

  return NextResponse.json({ ok:true, classified, highImpact, rebalance: rebResult, ms: Date.now()-t0 });
}
