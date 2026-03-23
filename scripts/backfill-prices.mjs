#!/usr/bin/env node
/**
 * Backfill MPF fund prices from MPFA monthly Excel files.
 * Downloads 12 months (Mar 2025 → Feb 2026), parses AIA section, upserts into Supabase.
 *
 * Usage: node scripts/backfill-prices.mjs
 * Requires: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local
 */

import * as XLSX from "xlsx";
import { readFileSync } from "fs";
import { resolve } from "path";

// Load env from .env.local
const envPath = resolve(process.cwd(), ".env.local");
try {
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const match = line.match(/^(\w+)="?([^"]*)"?$/);
    if (match) process.env[match[1]] = match[2];
  }
} catch { /* ignore */ }

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=minimal",
};

// MPFA fund names → our internal fund codes
const MPFA_NAME_TO_CODE = {
  "Age 65 Plus Fund": "AIA-65P",
  "American Fund": "AIA-AMI",
  "Asian Bond Fund": "AIA-ABF",
  "Asian Equity Fund": "AIA-AEF",
  "Balanced Portfolio": "AIA-BAL",
  "Capital Stable Portfolio": "AIA-CST",
  "China HK Dynamic Asset Allocation Fund": "AIA-CHD",
  "Core Accumulation Fund": "AIA-CAF",
  "Eurasia Fund": "AIA-EAI",
  "European Equity Fund": "AIA-EEF",
  "Global Bond Fund": "AIA-GBF",
  "Greater China Equity Fund": "AIA-GCF",
  "Green Fund": "AIA-GRF",
  "Growth Portfolio": "AIA-GRW",
  "Guaranteed Portfolio": "AIA-GPF",
  "Hong Kong and China Fund": "AIA-HCI",
  "Hong Kong Equity Fund": "AIA-HEF",
  "Japan Equity Fund": "AIA-JEF",
  "Manager's Choice Fund": "AIA-MCF",
  "MPF Conservative Fund": "AIA-CON",
  "North American Equity Fund": "AIA-NAF",
  "World Fund": "AIA-WIF",
  "Fidelity Growth Fund": "AIA-FGR",
  "Fidelity Stable Growth Fund": "AIA-FSG",
  "Fidelity Capital Stable Fund": "AIA-FCS",
};

function matchFundCode(name) {
  if (MPFA_NAME_TO_CODE[name]) return MPFA_NAME_TO_CODE[name];
  const lower = name.toLowerCase();
  for (const [display, code] of Object.entries(MPFA_NAME_TO_CODE)) {
    if (lower.includes(display.toLowerCase())) return code;
  }
  return null;
}

function getMPFAUrl(year, month) {
  const names = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
  return `https://www.mpfa.org.hk/en/-/media/files/information-centre/fund-information/monthly-fund-price/consolidated_list_for_${names[month-1]}_${String(year).slice(-2)}_read_only.xls`;
}

function parseExcel(buffer) {
  const wb = XLSX.read(new Uint8Array(buffer), { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });

  // Extract date from header row 4: "as at DD.MM.YYYY"
  let dateStr = "";
  const headerRow = data[4];
  if (headerRow) {
    const dateCell = String(headerRow[3] || "");
    const match = dateCell.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    if (match) dateStr = `${match[3]}-${match[2]}-${match[1]}`;
  }

  if (!dateStr) {
    const title = String(data[0]?.[0] || "");
    const m = title.match(/\((\w+)\s+(\d{4})\)/);
    if (m) {
      const map = { January:"01",February:"02",March:"03",April:"04",May:"05",June:"06",July:"07",August:"08",September:"09",October:"10",November:"11",December:"12" };
      dateStr = `${m[2]}-${map[m[1]] || "01"}-28`;
    }
  }

  // Find AIA section
  let aiaStart = -1, aiaEnd = data.length;
  for (let i = 7; i < data.length; i++) {
    const row = data[i];
    if (!row) continue;
    const col0 = row[0];
    if (typeof col0 === "string" && col0.trim()) {
      if (col0.includes("AIA") && aiaStart === -1) aiaStart = i;
      else if (aiaStart !== -1 && !col0.includes("AIA") && !col0.includes("友邦")) { aiaEnd = i; break; }
    }
  }

  const prices = [];
  for (let i = aiaStart; i < aiaEnd; i++) {
    const row = data[i];
    if (!row) continue;
    if (typeof row[2] === "string" && typeof row[3] === "number") {
      const code = matchFundCode(row[2]);
      if (code) prices.push({ fund_code: code, date: dateStr, nav: row[3], source: "mpfa" });
    }
  }

  return { prices, date: dateStr };
}

async function getFundIdMap() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/mpf_funds?select=id,fund_code`, { headers });
  return new Map((await res.json()).map(f => [f.fund_code, f.id]));
}

async function upsertPrice(fundMap, price) {
  const fund_id = fundMap.get(price.fund_code);
  if (!fund_id) return false;

  const res = await fetch(`${SUPABASE_URL}/rest/v1/mpf_prices`, {
    method: "POST",
    headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      fund_id,
      date: price.date,
      nav: price.nav,
      source: price.source,
      daily_change_pct: null, // Will calculate after all data is in
    }),
  });

  return res.ok;
}

async function calculateDailyChanges() {
  console.log("\nCalculating daily change percentages...");

  // Get all prices ordered by fund and date
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/mpf_prices?select=id,fund_id,date,nav&order=fund_id,date`,
    { headers }
  );
  const prices = await res.json();

  let updated = 0;
  let prevByFund = {};

  for (const p of prices) {
    const prev = prevByFund[p.fund_id];
    if (prev) {
      const pct = Number((((p.nav - prev.nav) / prev.nav) * 100).toFixed(4));
      await fetch(`${SUPABASE_URL}/rest/v1/mpf_prices?id=eq.${p.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ daily_change_pct: pct }),
      });
      updated++;
    }
    prevByFund[p.fund_id] = p;
  }

  console.log(`Updated ${updated} daily change values`);
}

async function main() {
  console.log("=== MPF Price Backfill ===\n");

  const fundMap = await getFundIdMap();
  console.log(`Fund map: ${fundMap.size} funds\n`);

  // Mar 2025 → Feb 2026
  const months = [
    ...Array.from({ length: 10 }, (_, i) => ({ year: 2025, month: i + 3 })),
    { year: 2026, month: 1 },
    { year: 2026, month: 2 },
  ];

  let totalUpserted = 0;

  for (const { year, month } of months) {
    const label = `${year}-${String(month).padStart(2, "0")}`;
    const url = getMPFAUrl(year, month);

    process.stdout.write(`${label}: downloading... `);

    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; AIA-Hub/1.0)" },
      });

      if (!res.ok) {
        console.log(`SKIP (HTTP ${res.status})`);
        continue;
      }

      const buffer = await res.arrayBuffer();
      const { prices, date } = parseExcel(buffer);

      process.stdout.write(`${prices.length} funds (${date})... `);

      let upserted = 0;
      for (const price of prices) {
        if (await upsertPrice(fundMap, price)) upserted++;
      }

      totalUpserted += upserted;
      console.log(`✓ ${upserted} upserted`);
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
    }
  }

  console.log(`\nTotal: ${totalUpserted} price records upserted`);

  // Calculate daily changes across all months
  await calculateDailyChanges();

  console.log("\n=== Backfill complete ===");
}

main().catch(console.error);
