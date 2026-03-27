#!/usr/bin/env node
/**
 * Test script for the defensive-first debate rebalancer.
 * Runs the full 4-call pipeline against LIVE Supabase data but does NOT write back.
 * Prints the full debate log so we can verify the agents go defensive when they should.
 *
 * Usage: node scripts/test-rebalancer.mjs
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";

// Load .env.local
const envPath = resolve(process.cwd(), ".env.local");
const envContent = readFileSync(envPath, "utf-8");
const env = {};
for (const line of envContent.split("\n")) {
  const m = line.match(/^([A-Z_]+)="?([^"]*)"?$/);
  if (m) env[m[1]] = m[2];
}

const GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";
const MODEL = "anthropic/claude-sonnet-4.6";
const PER_CALL_TIMEOUT = 60000; // 60s — debate calls are heavier with new prompts

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// ===== CONSTANTS (mirrored from constants.ts) =====
const INVESTMENT_PROFILES = {
  age_based: { age: 35, equity_pct: 75, label: "35yo Growth (age-based)" },
  pure_quant: { age: null, equity_pct: null, label: "Pure Quantitative + News (no age assumption)" },
};

const EQUITY_CODES = ["AEF","EEF","GCF","NAF","GRF","AMI","EAI","HCI","WIF","GRW","CHD","MCF"];

// ===== HELPER FUNCTIONS =====
async function callGateway(systemPrompt, userContent) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PER_CALL_TIMEOUT);
  try {
    const res = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.AI_GATEWAY_API_KEY}` },
      body: JSON.stringify({ model: MODEL, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userContent }], temperature: 0.3 }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`AI Gateway ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
  } catch (e) { clearTimeout(timeout); throw e; }
}

function parseJSON(raw) {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

// ===== DANGER DETECTION =====
function detectDangerSignals(metricsText) {
  const lines = metricsText.split("\n").filter(Boolean);
  const dangers = [];
  let negativeSortinoCount = 0, deepDrawdownCount = 0, negativeMomentumCount = 0, totalEquityFunds = 0;

  for (const line of lines) {
    const code = line.split(":")[0]?.trim();
    if (!code) continue;
    const isEquity = EQUITY_CODES.some(c => code.includes(c));
    if (!isEquity) continue;
    totalEquityFunds++;

    const sortino = line.match(/Sortino=([-\d.]+)/)?.[1];
    const maxDD = line.match(/MaxDD=([-\d.]+)%/)?.[1];
    const mom = line.match(/Mom3M=([-\d.]+)%/)?.[1];

    if (sortino && parseFloat(sortino) < 0) negativeSortinoCount++;
    if (maxDD && parseFloat(maxDD) < -20) deepDrawdownCount++;
    if (mom && parseFloat(mom) < -5) negativeMomentumCount++;
  }

  const majorityNegSortino = totalEquityFunds > 0 && (negativeSortinoCount / totalEquityFunds) > 0.5;
  const majorityDeepDD = totalEquityFunds > 0 && (deepDrawdownCount / totalEquityFunds) > 0.4;
  const majorityNegMom = totalEquityFunds > 0 && (negativeMomentumCount / totalEquityFunds) > 0.5;

  if (majorityNegSortino) dangers.push(`DANGER: ${negativeSortinoCount}/${totalEquityFunds} equity funds have NEGATIVE Sortino ratios`);
  if (majorityDeepDD) dangers.push(`DANGER: ${deepDrawdownCount}/${totalEquityFunds} equity funds have max drawdowns worse than -20%`);
  if (majorityNegMom) dangers.push(`DANGER: ${negativeMomentumCount}/${totalEquityFunds} equity funds have negative 3-month momentum`);
  if (dangers.length >= 2) dangers.push("⚠️ MULTIPLE DANGER SIGNALS ACTIVE");

  return dangers.length > 0 ? `\n\n🚨 QUANTITATIVE DANGER SIGNALS:\n${dangers.join("\n")}` : "";
}

// ===== MAIN =====
async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  REBALANCER TEST — Defensive-First Logic (DRY RUN)");
  console.log("═══════════════════════════════════════════════════════\n");

  // 1. Fetch current portfolio
  const { data: portfolio } = await supabase.from("mpf_reference_portfolio").select("fund_id, weight, note");
  const { data: funds } = await supabase.from("mpf_funds").select("id, fund_code, name_en, category, risk_rating");
  const fundMap = new Map((funds || []).map(f => [f.id, f]));

  const currentHoldings = (portfolio || []).map(p => {
    const fund = fundMap.get(p.fund_id);
    return { code: fund?.fund_code || "?", name: fund?.name_en || "?", weight: p.weight };
  });

  console.log("📋 CURRENT PORTFOLIO:");
  for (const h of currentHoldings) console.log(`   ${h.code} (${h.name}): ${h.weight}%`);
  console.log();

  // 2. Fetch metrics
  const { data: metrics } = await supabase.from("mpf_fund_metrics").select("*").eq("period", "3y");
  const metricsText = (metrics || []).map(m =>
    `${m.fund_code}: Sortino=${m.sortino_ratio?.toFixed(2) ?? "N/A"}, Sharpe=${m.sharpe_ratio?.toFixed(2) ?? "N/A"}, MaxDD=${m.max_drawdown_pct !== null ? (m.max_drawdown_pct * 100).toFixed(1) + "%" : "N/A"}, CAGR=${m.annualized_return_pct !== null ? (m.annualized_return_pct * 100).toFixed(1) + "%" : "N/A"}, FER=${m.expense_ratio_pct?.toFixed(2) ?? "N/A"}%, Mom3M=${m.momentum_score !== null ? (m.momentum_score * 100).toFixed(1) + "%" : "N/A"}`
  ).join("\n");

  console.log("📊 FUND METRICS (3Y):");
  console.log(metricsText);
  console.log();

  // 3. Danger detection
  const dangerSignals = detectDangerSignals(metricsText);
  if (dangerSignals) {
    console.log("🚨 DANGER SIGNALS DETECTED:");
    console.log(dangerSignals);
    console.log();
  } else {
    console.log("✅ No danger signals detected\n");
  }

  // 4. Fetch recent news
  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const { data: recentNews } = await supabase.from("mpf_news")
    .select("headline, impact_tags, sentiment, region, is_high_impact")
    .gte("published_at", twoDaysAgo)
    .order("published_at", { ascending: false })
    .limit(20);

  const newsText = (recentNews || []).map(n =>
    `[${n.sentiment}/${n.region}${n.is_high_impact ? "/HIGH-IMPACT" : ""}] ${n.headline} (tags: ${n.impact_tags?.join(", ") || "none"})`
  ).join("\n");

  console.log("📰 RECENT NEWS (48h):");
  console.log(newsText || "(none)");
  console.log();

  // 5. Build prompts
  const currentPortfolioText = currentHoldings.map(h => `${h.code} (${h.name}): ${h.weight}%`).join("\n");
  const availableFunds = (funds || []).map(f => `${f.fund_code} (${f.name_en})`).join(", ");

  const ageProfile = INVESTMENT_PROFILES.age_based;
  const pureProfile = INVESTMENT_PROFILES.pure_quant;
  const profileText = [
    `PERSPECTIVE 1 (Age-Based): ${ageProfile.label}, equity anchor ${ageProfile.equity_pct}% — but this is a CEILING, not a floor. Go lower if data warrants.`,
    `PERSPECTIVE 2 (Pure Data): ${pureProfile.label} — ignore age entirely. What do the numbers and news actually say?`,
    `YOUR JOB: Consider both perspectives. When they conflict, the MORE CAUTIOUS wins.`,
  ].join("\n");

  const sharedConstraints = `
INVESTMENT PHILOSOPHY — "The best winning is not losing. Then comes winning."
Your DEFAULT stance is DEFENSIVE. You must EARN the right to allocate to equity with clear evidence.

STRICT RULES:
1. Output exactly 3 funds. Duplicates allowed.
2. Weights: 0-100% in 10% increments. Total MUST = 100%.
3. DEFENSIVE-FIRST: Start from 100% cash/bonds. Add equity ONLY with specific evidence it's safe.
4. Capital preservation is NON-NEGOTIABLE. A 30% loss requires a 43% gain to recover.
5. If danger signals are present, maximum 40% equity unless you provide exceptional justification.
6. 100% defensive (AIA-CON + bonds) is a VALID and often CORRECT decision.
7. "The market might recover" is NOT a reason to stay in equity.
${dangerSignals}

Available funds: ${availableFunds}
Defensive funds: AIA-CON (cash, 0.39% FER), AIA-ABF (Asian bonds), AIA-GBF (Global bonds), AIA-GPF (guaranteed), AIA-CST (capital stable)

Return ONLY valid JSON (no markdown):
{ "funds": [{ "code": "AIA-XXX", "weight": 50, "reasoning": "why" }, ...], "summary": "1-2 sentence summary" }`;

  // 6. Run debate pipeline
  console.log("═══════════════════════════════════════════════════════");
  console.log("  RUNNING 4-CALL DEBATE PIPELINE...");
  console.log("═══════════════════════════════════════════════════════\n");

  const t0 = Date.now();

  // Step 1: Parallel proposals
  console.log("⏳ Step 1: Quant Agent + News Agent (parallel)...");
  const [quantRaw, newsAgentRaw] = await Promise.all([
    callGateway(
      `You are a RISK-FIRST quantitative analyst for an MPF pension fund. Your job is to PROTECT capital first, grow it second.

DECISION FRAMEWORK (in order):
1. CHECK SORTINO RATIOS: If most equity funds have Sortino < 0.5, the risk-reward is unfavorable. Go defensive.
2. CHECK MAX DRAWDOWN: If any fund in the current portfolio has drawdown > -15%, that fund must be replaced or reduced.
3. CHECK MOMENTUM: If 3-month momentum is negative for majority of equity funds, the trend is DOWN. Do not fight the trend.
4. ONLY THEN consider upside: If Sortino > 1.0, drawdown is recovering, and momentum is positive — allocate to equity.

You are a SKEPTIC, not an optimist. Your job is to say "the numbers don't justify equity" when they don't.`,
      `${profileText}\n\nCURRENT PORTFOLIO:\n${currentPortfolioText}\n\nFUND METRICS (3Y):\n${metricsText}\n\n${sharedConstraints}`
    ),
    callGateway(
      `You are a GEOPOLITICAL RISK analyst for an MPF pension fund. Your PRIMARY job is to detect DANGER before it hits the portfolio.

THREAT ASSESSMENT FRAMEWORK:
1. WAR / MILITARY CONFLICT: Any active or escalating conflict → IMMEDIATE defensive shift. Minimum 60% defensive.
2. SANCTIONS / TRADE WAR: Broad sanctions, tariff escalation → defensive shift for affected regions.
3. CENTRAL BANK HAWKISHNESS: Rate hikes, tightening signals → reduce equity, increase bonds.
4. CURRENCY CRISIS: Major currency moves → reduce exposure to affected region.
5. POLITICAL INSTABILITY: Elections, regime change, policy uncertainty → reduce equity in that region.

ONLY go offense if: No active threats, positive sentiment across regions, AND market is in confirmed uptrend.
"No recent news" does NOT mean "safe." It means you lack information — default to CAUTION, not optimism.
A BLANK news feed = at least 40% defensive allocation.`,
      `${profileText}\n\nCURRENT PORTFOLIO:\n${currentPortfolioText}\n\nRECENT NEWS (48h):\n${newsText || "No recent news"}\n\n${sharedConstraints}`
    ),
  ]);

  const quantProposal = parseJSON(quantRaw);
  const newsProposal = parseJSON(newsAgentRaw);

  console.log("\n📈 QUANT AGENT PROPOSAL:");
  if (quantProposal) {
    console.log(`   Summary: ${quantProposal.summary}`);
    for (const f of quantProposal.funds) console.log(`   ${f.code}: ${f.weight}% — ${f.reasoning}`);
  } else {
    console.log("   ❌ Failed to parse! Raw:", quantRaw.slice(0, 300));
  }

  console.log("\n📰 NEWS AGENT PROPOSAL:");
  if (newsProposal) {
    console.log(`   Summary: ${newsProposal.summary}`);
    for (const f of newsProposal.funds) console.log(`   ${f.code}: ${f.weight}% — ${f.reasoning}`);
  } else {
    console.log("   ❌ Failed to parse! Raw:", newsAgentRaw.slice(0, 300));
  }

  if (!quantProposal || !newsProposal) {
    console.log("\n❌ Cannot proceed — agent proposals failed to parse.");
    process.exit(1);
  }

  // Step 2: Debate
  console.log("\n⏳ Step 2: Risk Committee Debate...");
  const debateRaw = await callGateway(
    `You are the RISK COMMITTEE reviewing two proposals for a pension fund. Your bias is TOWARD SAFETY.

DEBATE RULES:
1. When Quant and News DISAGREE on risk level, the MORE CAUTIOUS position wins by default.
2. If EITHER agent recommends >50% defensive, take that seriously.
3. "Long-term recovery" is not a valid argument during active risk events.
4. If both agents agree on equity allocation, that's fine. But if either flags danger, reflect it.
5. Be decisive. When in doubt, be defensive.

Remember: A -30% loss needs +43% to recover. A -50% loss needs +100%. Avoiding the dip IS the strategy.`,
    `QUANT AGENT PROPOSAL:\n${JSON.stringify(quantProposal, null, 2)}\n\nNEWS AGENT PROPOSAL:\n${JSON.stringify(newsProposal, null, 2)}\n\nReturn JSON: { "agreements": ["..."], "conflicts": [{ "topic": "...", "quantPosition": "...", "newsPosition": "...", "verdict": "quant|news", "reasoning": "..." }], "recommendation": "1-2 sentence recommendation" }`
  );

  const debate = parseJSON(debateRaw);
  console.log("\n⚖️ DEBATE RESULT:");
  if (debate) {
    console.log(`   Agreements: ${debate.agreements?.join("; ")}`);
    for (const c of debate.conflicts || []) {
      console.log(`   Conflict: ${c.topic}`);
      console.log(`     Quant: ${c.quantPosition}`);
      console.log(`     News:  ${c.newsPosition}`);
      console.log(`     Verdict: ${c.verdict} — ${c.reasoning}`);
    }
    console.log(`   Recommendation: ${debate.recommendation}`);
  } else {
    console.log("   ❌ Failed to parse! Raw:", debateRaw.slice(0, 300));
    process.exit(1);
  }

  // Step 3: Mediator (CRO)
  console.log("\n⏳ Step 3: Chief Risk Officer Final Decision...");
  const mediatorRaw = await callGateway(
    `You are the CHIEF RISK OFFICER making the final portfolio allocation. You are personally accountable for losses.

YOUR MANDATE:
- "The best winning is not losing. Then comes winning."
- You would rather explain why you were too cautious than explain why you lost 20% of the portfolio.
- If the debate shows ANY unresolved danger signals, your portfolio MUST reflect that risk — minimum 40% defensive.
- Only go >60% equity when BOTH agents agree conditions are favorable AND no danger signals are active.
- You are NOT a consensus-seeker. If one agent is cautious for good reason, override the other.

${sharedConstraints}

Return JSON: { "funds": [{ "code": "AIA-XXX", "weight": 50 }, ...], "summary_en": "plain English summary for the team", "summary_zh": "中文摘要", "debate_log": "Quant said X. News said Y. They agreed on Z. Final decision: ..." }`,
    `QUANT PROPOSAL:\n${JSON.stringify(quantProposal, null, 2)}\n\nNEWS PROPOSAL:\n${JSON.stringify(newsProposal, null, 2)}\n\nDEBATE:\n${JSON.stringify(debate, null, 2)}\n\nFUND METRICS:\n${metricsText}\n\nNEWS SUMMARY:\n${newsText || "No recent news"}`
  );

  const mediator = parseJSON(mediatorRaw);
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  FINAL DECISION (DRY RUN — NOT APPLIED)");
  console.log("═══════════════════════════════════════════════════════\n");

  if (mediator) {
    console.log("📊 NEW ALLOCATION:");
    const defensiveCodes = new Set(["AIA-CON", "AIA-ABF", "AIA-GBF", "AIA-GPF", "AIA-CST", "AIA-65P"]);
    let equityPct = 0, defensivePct = 0;
    for (const f of mediator.funds || []) {
      const isDefensive = defensiveCodes.has(f.code);
      if (isDefensive) defensivePct += f.weight; else equityPct += f.weight;
      console.log(`   ${f.code}: ${f.weight}% ${isDefensive ? "(defensive)" : "(equity)"}`);
    }
    console.log(`\n   Equity: ${equityPct}% | Defensive: ${defensivePct}%`);

    if (dangerSignals && equityPct > 40) {
      console.log(`\n   ⚠️ SAFETY GUARDRAIL: ${equityPct}% equity despite danger signals! Would trigger warning.`);
    }

    console.log(`\n📝 Summary (EN): ${mediator.summary_en}`);
    console.log(`📝 Summary (ZH): ${mediator.summary_zh}`);
    console.log(`\n📋 Debate Log: ${mediator.debate_log}`);
  } else {
    console.log("   ❌ Failed to parse mediator! Raw:", mediatorRaw.slice(0, 500));
  }

  console.log(`\n⏱️ Total time: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log("\n✅ DRY RUN COMPLETE — no changes written to database.");
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
