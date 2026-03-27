#!/usr/bin/env node
/**
 * HEAD-TO-HEAD BACKTEST: Old Logic vs New Defensive-First Logic
 *
 * Period: Jan 1 2026 → Mar 27 2026 (3 months)
 * Rebalance: every 4 weeks (monthly)
 * Track A: OLD prompts (neutral, consensus-seeking, 28yo/82% equity anchor)
 * Track B: NEW prompts (defensive-first, dual-profile, danger detection)
 *
 * Uses REAL price data from Supabase. No news (backtesting news is unreliable).
 * This is a QUANT-ONLY comparison to isolate the prompt engineering effect.
 *
 * Usage: node scripts/backtest-compare.mjs
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
const TIMEOUT = 60000;

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// ===== CONFIG =====
const START_DATE = "2026-01-01";
const END_DATE = "2026-03-27";
const REBALANCE_EVERY_WEEKS = 4;
const INITIAL_PORTFOLIO = [
  { code: "AIA-GCF", weight: 40 },
  { code: "AIA-EEF", weight: 30 },
  { code: "AIA-AMI", weight: 30 },
];

const EQUITY_CODES = ["AEF","EEF","GCF","NAF","GRF","AMI","EAI","HCI","WIF","GRW","CHD","MCF"];
const RISK_FREE_RATE = 0.04;

// ===== HELPERS =====
async function callGateway(systemPrompt, userContent) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.AI_GATEWAY_API_KEY}` },
      body: JSON.stringify({ model: MODEL, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userContent }], temperature: 0.3 }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`Gateway ${res.status}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
  } catch (e) { clearTimeout(timeout); throw e; }
}

function parseJSON(raw) {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

function findClosestNav(prices, targetDate) {
  for (let i = prices.length - 1; i >= 0; i--) {
    if (prices[i].date <= targetDate) return prices[i].nav;
  }
  return null;
}

function computeWeeklyReturn(allocation, priceMap, weekStart, weekEnd) {
  let total = 0;
  for (const { code, weight } of allocation) {
    if (weight === 0) continue;
    const prices = priceMap.get(code);
    if (!prices) continue;
    const startNav = findClosestNav(prices, weekStart);
    const endNav = findClosestNav(prices, weekEnd);
    if (!startNav || !endNav || startNav === 0) continue;
    total += ((endNav - startNav) / startNav) * (weight / 100);
  }
  return total;
}

// ===== METRICS COMPUTATION (point-in-time) =====
function computeMetrics(prices, riskFreeRate = RISK_FREE_RATE) {
  if (prices.length < 60) return null;

  // Use last 3 years or all available
  const threeYearsAgo = addDays(prices[prices.length - 1].date, -1095);
  const filtered = prices.filter(p => p.date >= threeYearsAgo);
  if (filtered.length < 60) return null;

  const dailyReturns = [];
  for (let i = 1; i < filtered.length; i++) {
    if (filtered[i - 1].nav === 0) continue;
    dailyReturns.push((filtered[i].nav - filtered[i - 1].nav) / filtered[i - 1].nav);
  }

  const years = dailyReturns.length / 252;
  const totalReturn = filtered[filtered.length - 1].nav / filtered[0].nav - 1;
  const cagr = Math.pow(1 + totalReturn, 1 / years) - 1;

  const mean = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / dailyReturns.length;
  const vol = Math.sqrt(variance * 252);

  const sharpe = vol === 0 ? 0 : (cagr - riskFreeRate) / vol;

  const downsideReturns = dailyReturns.filter(r => r < 0);
  const downsideVar = downsideReturns.length > 0
    ? downsideReturns.reduce((s, r) => s + r ** 2, 0) / dailyReturns.length
    : 0;
  const downsideDev = Math.sqrt(downsideVar * 252);
  const sortino = downsideDev === 0 ? 0 : (cagr - riskFreeRate) / downsideDev;

  // Max drawdown
  let peak = filtered[0].nav;
  let maxDD = 0;
  for (const p of filtered) {
    if (p.nav > peak) peak = p.nav;
    const dd = (p.nav - peak) / peak;
    if (dd < maxDD) maxDD = dd;
  }

  // 3-month momentum
  const threeMonthsAgo = addDays(filtered[filtered.length - 1].date, -91);
  const momStart = findClosestNav(filtered, threeMonthsAgo);
  const momEnd = filtered[filtered.length - 1].nav;
  const momentum = momStart && momStart > 0 ? (momEnd - momStart) / momStart : 0;

  return { sortino, sharpe, maxDD, cagr, vol, momentum };
}

// ===== DANGER DETECTION (new logic only) =====
function detectDangerSignals(fundMetrics) {
  let negativeSortino = 0, deepDD = 0, negMom = 0, totalEquity = 0;

  for (const [code, m] of fundMetrics) {
    if (!EQUITY_CODES.some(c => code.includes(c))) continue;
    if (!m) continue;
    totalEquity++;
    if (m.sortino < 0) negativeSortino++;
    if (m.maxDD < -0.20) deepDD++;
    if (m.momentum < -0.05) negMom++;
  }

  const dangers = [];
  if (totalEquity > 0 && negativeSortino / totalEquity > 0.5) dangers.push(`${negativeSortino}/${totalEquity} equity funds have negative Sortino`);
  if (totalEquity > 0 && deepDD / totalEquity > 0.4) dangers.push(`${deepDD}/${totalEquity} equity funds have MaxDD worse than -20%`);
  if (totalEquity > 0 && negMom / totalEquity > 0.5) dangers.push(`${negMom}/${totalEquity} equity funds have negative 3M momentum`);

  return dangers.length > 0 ? dangers.join("; ") : "";
}

// ===== OLD LOGIC (Track A) =====
async function rebalanceOldLogic(metricsText, currentPortfolioText, availableFunds) {
  const profileText = "Profile: 28yo Long-Term Growth, equity target 82%";
  const constraints = `
STRICT RULES:
1. Output exactly 3 funds. Duplicates allowed.
2. Weights: 0-100% in 10% increments. Total MUST = 100%.
3. Prioritize: (1) capital preservation, (2) long-term compounding. Never chase short-term returns.
4. 100% equity is valid. 100% cash (AIA-CON) is valid. No allocation limits.
Available funds: ${availableFunds}
Return ONLY valid JSON (no markdown):
{ "funds": [{ "code": "AIA-XXX", "weight": 50, "reasoning": "why" }, ...], "summary": "1-2 sentence summary" }`;

  const raw = await callGateway(
    "You are a quantitative analyst for an MPF pension fund. Propose a 3-fund portfolio based PURELY on the metrics below. Ignore news — focus only on the numbers.",
    `${profileText}\n\nCURRENT PORTFOLIO:\n${currentPortfolioText}\n\nFUND METRICS (3Y):\n${metricsText}\n\n${constraints}`
  );
  return parseJSON(raw);
}

// ===== NEW LOGIC (Track B) =====
async function rebalanceNewLogic(metricsText, currentPortfolioText, availableFunds, dangerSignals) {
  const profileText = [
    "PERSPECTIVE 1 (Age-Based): 35yo Growth, equity anchor 75% — but this is a CEILING, not a floor. Go lower if data warrants.",
    "PERSPECTIVE 2 (Pure Data): Pure Quantitative (no age assumption) — ignore age entirely. What do the numbers actually say?",
    "YOUR JOB: Consider both perspectives. When they conflict, the MORE CAUTIOUS wins.",
  ].join("\n");

  const dangerBlock = dangerSignals ? `\n\n🚨 QUANTITATIVE DANGER SIGNALS:\n${dangerSignals}\n⚠️ MULTIPLE DANGER SIGNALS ACTIVE — default stance MUST be defensive.` : "";

  const constraints = `
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
${dangerBlock}

Available funds: ${availableFunds}
Defensive funds: AIA-CON (cash, 0.39% FER), AIA-ABF (Asian bonds), AIA-GBF (Global bonds), AIA-GPF (guaranteed), AIA-CST (capital stable)

Return ONLY valid JSON (no markdown):
{ "funds": [{ "code": "AIA-XXX", "weight": 50, "reasoning": "why" }, ...], "summary": "1-2 sentence summary" }`;

  const raw = await callGateway(
    `You are a RISK-FIRST quantitative analyst for an MPF pension fund. Your job is to PROTECT capital first, grow it second.

DECISION FRAMEWORK (in order):
1. CHECK SORTINO RATIOS: If most equity funds have Sortino < 0.5, the risk-reward is unfavorable. Go defensive.
2. CHECK MAX DRAWDOWN: If any fund in the current portfolio has drawdown > -15%, that fund must be replaced or reduced.
3. CHECK MOMENTUM: If 3-month momentum is negative for majority of equity funds, the trend is DOWN. Do not fight the trend.
4. ONLY THEN consider upside: If Sortino > 1.0, drawdown is recovering, and momentum is positive — allocate to equity.

You are a SKEPTIC, not an optimist.`,
    `${profileText}\n\nCURRENT PORTFOLIO:\n${currentPortfolioText}\n\nFUND METRICS (3Y):\n${metricsText}\n\n${constraints}`
  );
  return parseJSON(raw);
}

// ===== MAIN =====
async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  BACKTEST: Old Logic (Track A) vs New Defensive-First (Track B)");
  console.log(`  Period: ${START_DATE} → ${END_DATE} (3 months)`);
  console.log("  Rebalance: every 4 weeks | Quant-only (no news, fair comparison)");
  console.log("═══════════════════════════════════════════════════════════════\n");

  // 1. Load all prices
  console.log("Loading price data...");
  const allPriceRows = [];
  let offset = 0;
  while (true) {
    const { data: page } = await supabase.from("mpf_prices").select("fund_id, date, nav")
      .gte("date", addDays(START_DATE, -1095)) // need 3Y history for metrics
      .order("date", { ascending: true }).range(offset, offset + 999).limit(1000);
    if (!page || page.length === 0) break;
    allPriceRows.push(...page);
    offset += page.length;
    if (page.length < 1000) break;
  }

  const { data: fundsData } = await supabase.from("mpf_funds").select("id, fund_code, name_en").eq("is_active", true);
  const fundIdToCode = new Map((fundsData || []).map(f => [f.id, f.fund_code]));
  const fundCodeToName = new Map((fundsData || []).map(f => [f.fund_code, f.name_en]));

  const priceMap = new Map();
  for (const row of allPriceRows) {
    const code = fundIdToCode.get(row.fund_id);
    if (!code) continue;
    if (!priceMap.has(code)) priceMap.set(code, []);
    priceMap.get(code).push({ date: row.date, nav: Number(row.nav) });
  }

  console.log(`Loaded ${allPriceRows.length} prices for ${priceMap.size} funds\n`);

  const availableFunds = (fundsData || []).map(f => `${f.fund_code} (${f.name_en})`).join(", ");

  // 2. Generate weekly dates
  const weeks = [];
  let d = START_DATE;
  while (d < END_DATE) {
    weeks.push(d);
    d = addDays(d, 7);
  }

  console.log(`Simulation: ${weeks.length} weeks\n`);

  // 3. Run both tracks
  let trackA = { allocation: [...INITIAL_PORTFOLIO], cumReturn: 0, weeksSinceRebalance: 0 };
  let trackB = { allocation: [...INITIAL_PORTFOLIO], cumReturn: 0, weeksSinceRebalance: 0 };

  const weeklyLog = [];
  let totalCalls = 0;

  for (let i = 0; i < weeks.length; i++) {
    const weekStart = weeks[i];
    const weekEnd = i + 1 < weeks.length ? weeks[i + 1] : END_DATE;

    const shouldRebalance = trackA.weeksSinceRebalance >= REBALANCE_EVERY_WEEKS || i === 0;

    if (shouldRebalance && i > 0) {
      // Compute point-in-time metrics
      const pitPrices = new Map();
      for (const [code, prices] of priceMap) {
        pitPrices.set(code, prices.filter(p => p.date <= weekStart));
      }

      const fundMetrics = new Map();
      const metricsLines = [];
      for (const [code, prices] of pitPrices) {
        const m = computeMetrics(prices);
        if (!m) continue;
        fundMetrics.set(code, m);
        metricsLines.push(`${code}: Sortino=${m.sortino.toFixed(2)}, Sharpe=${m.sharpe.toFixed(2)}, MaxDD=${(m.maxDD * 100).toFixed(1)}%, CAGR=${(m.cagr * 100).toFixed(1)}%, Mom3M=${(m.momentum * 100).toFixed(1)}%`);
      }
      const metricsText = metricsLines.join("\n");

      const portfolioTextA = trackA.allocation.map(a => `${a.code} (${fundCodeToName.get(a.code) || "?"}): ${a.weight}%`).join("\n");
      const portfolioTextB = trackB.allocation.map(a => `${a.code} (${fundCodeToName.get(a.code) || "?"}): ${a.weight}%`).join("\n");

      console.log(`\n📅 REBALANCE @ ${weekStart}`);
      console.log("─".repeat(60));

      // Track A: Old logic
      console.log("⏳ Track A (Old Logic)...");
      try {
        const proposalA = await rebalanceOldLogic(metricsText, portfolioTextA, availableFunds);
        if (proposalA?.funds) {
          trackA.allocation = proposalA.funds.map(f => ({ code: f.code, weight: f.weight }));
          // Normalize
          const total = trackA.allocation.reduce((s, f) => s + f.weight, 0);
          if (total !== 100) trackA.allocation[0].weight += 100 - total;
          console.log(`   → ${trackA.allocation.map(f => `${f.code} ${f.weight}%`).join(" / ")}`);
          console.log(`   Summary: ${proposalA.summary}`);
        } else {
          console.log("   → Parse failed, carrying forward");
        }
      } catch (e) { console.log(`   → Error: ${e.message}, carrying forward`); }
      totalCalls++;

      // Track B: New logic
      console.log("⏳ Track B (New Defensive Logic)...");
      try {
        const dangerSignals = detectDangerSignals(fundMetrics);
        if (dangerSignals) console.log(`   🚨 Danger: ${dangerSignals}`);

        const proposalB = await rebalanceNewLogic(metricsText, portfolioTextB, availableFunds, dangerSignals);
        if (proposalB?.funds) {
          trackB.allocation = proposalB.funds.map(f => ({ code: f.code, weight: f.weight }));
          const total = trackB.allocation.reduce((s, f) => s + f.weight, 0);
          if (total !== 100) trackB.allocation[0].weight += 100 - total;
          console.log(`   → ${trackB.allocation.map(f => `${f.code} ${f.weight}%`).join(" / ")}`);
          console.log(`   Summary: ${proposalB.summary}`);
        } else {
          console.log("   → Parse failed, carrying forward");
        }
      } catch (e) { console.log(`   → Error: ${e.message}, carrying forward`); }
      totalCalls++;

      trackA.weeksSinceRebalance = 0;
      trackB.weeksSinceRebalance = 0;
    }

    // Compute weekly returns
    const returnA = computeWeeklyReturn(trackA.allocation, priceMap, weekStart, weekEnd);
    const returnB = computeWeeklyReturn(trackB.allocation, priceMap, weekStart, weekEnd);

    trackA.cumReturn = (1 + trackA.cumReturn) * (1 + returnA) - 1;
    trackB.cumReturn = (1 + trackB.cumReturn) * (1 + returnB) - 1;
    trackA.weeksSinceRebalance++;
    trackB.weeksSinceRebalance++;

    weeklyLog.push({
      week: weekStart,
      returnA: (returnA * 100).toFixed(2),
      returnB: (returnB * 100).toFixed(2),
      cumA: (trackA.cumReturn * 100).toFixed(2),
      cumB: (trackB.cumReturn * 100).toFixed(2),
      allocA: trackA.allocation.map(f => `${f.code}:${f.weight}`).join("/"),
      allocB: trackB.allocation.map(f => `${f.code}:${f.weight}`).join("/"),
    });
  }

  // 4. Print results
  console.log("\n\n═══════════════════════════════════════════════════════════════");
  console.log("  WEEKLY PERFORMANCE LOG");
  console.log("═══════════════════════════════════════════════════════════════\n");

  console.log("Week        | A Weekly | B Weekly | A Cumul  | B Cumul  | A Alloc                              | B Alloc");
  console.log("─".repeat(140));
  for (const w of weeklyLog) {
    const aW = w.returnA.padStart(7);
    const bW = w.returnB.padStart(7);
    const aC = w.cumA.padStart(7);
    const bC = w.cumB.padStart(7);
    console.log(`${w.week} | ${aW}% | ${bW}% | ${aC}% | ${bC}% | ${w.allocA.padEnd(36)} | ${w.allocB}`);
  }

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  FINAL RESULTS");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const finalA = (trackA.cumReturn * 100).toFixed(2);
  const finalB = (trackB.cumReturn * 100).toFixed(2);
  const winner = trackA.cumReturn > trackB.cumReturn ? "A (Old)" : "B (New Defensive)";
  const diff = Math.abs(trackA.cumReturn - trackB.cumReturn) * 100;

  console.log(`Track A (Old Logic):          ${finalA}%`);
  console.log(`Track B (New Defensive):      ${finalB}%`);
  console.log(`Difference:                   ${diff.toFixed(2)}%`);
  console.log(`Winner:                       ${winner}`);
  console.log(`\nTotal LLM calls:              ${totalCalls}`);

  // Max drawdown for each track
  let peakA = 0, peakB = 0, maxDDA = 0, maxDDB = 0;
  for (const w of weeklyLog) {
    const cumA = parseFloat(w.cumA) / 100;
    const cumB = parseFloat(w.cumB) / 100;
    const valA = 1 + cumA;
    const valB = 1 + cumB;
    if (valA > peakA) peakA = valA;
    if (valB > peakB) peakB = valB;
    const ddA = (valA - peakA) / peakA;
    const ddB = (valB - peakB) / peakB;
    if (ddA < maxDDA) maxDDA = ddA;
    if (ddB < maxDDB) maxDDB = ddB;
  }

  console.log(`\nMax Drawdown A (Old):         ${(maxDDA * 100).toFixed(2)}%`);
  console.log(`Max Drawdown B (New):         ${(maxDDB * 100).toFixed(2)}%`);
  console.log(`\n"The best winning is not losing. Then comes winning."`);
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
