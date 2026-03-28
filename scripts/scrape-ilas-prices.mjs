#!/usr/bin/env node
// scripts/scrape-ilas-prices.mjs
// Local Playwright script to scrape ILAS fund prices from AIA website
// and POST them to the /api/ilas/cron/prices endpoint.
//
// Usage: node scripts/scrape-ilas-prices.mjs
// Requires: CRON_SECRET env var (or reads from .env.local)
// Requires: playwright installed (npx playwright install chromium)

import { chromium } from "playwright";
import { readFileSync } from "fs";
import { resolve } from "path";

// Load env
try {
  const envPath = resolve(process.cwd(), ".env.local");
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const match = line.match(/^([^#=]+)=["']?(.+?)["']?$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
} catch {}

const CRON_SECRET = process.env.CRON_SECRET;
const API_URL =
  process.env.ILAS_API_URL ||
  "https://aia-assistant.vercel.app/api/ilas/cron/prices";

if (!CRON_SECRET) {
  console.error("CRON_SECRET not found in env");
  process.exit(1);
}

async function scrape() {
  console.log("[ilas-scraper] Launching browser...");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    console.log("[ilas-scraper] Navigating to AIA investment page...");
    await page.goto(
      "https://www.aia.com.hk/en/help-and-support/individuals/investment-information/investment-options-prices.html",
      { waitUntil: "networkidle", timeout: 30000 }
    );

    // Close cookie banner if present
    await page
      .locator('button:has-text("Close")')
      .first()
      .click({ timeout: 3000 })
      .catch(() => {});

    // Click important info confirm
    await page.evaluate(() => {
      const btn = document.querySelector("#btn728528932");
      if (btn) btn.click();
    });
    await page.waitForTimeout(2000);

    // Select "List All" in asset class dropdown
    await page.evaluate(() => {
      const selects = document.querySelectorAll("select");
      for (const s of selects) {
        const options = Array.from(s.options);
        const listAll = options.find((o) => o.text.includes("List All"));
        if (listAll) {
          s.value = listAll.value;
          s.dispatchEvent(new Event("change"));
          break;
        }
      }
    });
    await page.waitForTimeout(1000);

    // Click search
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button"));
      const search = buttons.find(
        (b) => b.textContent.trim().toLowerCase() === "search"
      );
      if (search) search.click();
    });

    console.log("[ilas-scraper] Waiting for fund data to load...");
    await page.waitForTimeout(6000);

    // Extract fund prices
    const prices = await page.evaluate(() => {
      const rows = document.querySelectorAll("table tbody tr");
      const data = [];
      for (const row of rows) {
        const cells = row.querySelectorAll("td");
        if (cells.length >= 6) {
          const rawName = cells[0]?.textContent?.trim() || "";
          const code = cells[1]?.textContent?.trim() || "";
          const priceRaw = cells[3]?.textContent?.trim() || "";
          const bidRaw = cells[4]?.textContent?.trim() || "";
          const dateRaw = cells[5]?.textContent?.trim() || "";

          // Parse currency + price
          const cleaned = priceRaw.replace(/[▼▲►◄\s]/g, "").trim();
          const priceMatch = cleaned.match(
            /^(US\$|HK\$|RMB|EUR€?|GBP|JPY|AUD)(.+)$/
          );
          const bidCleaned = bidRaw.replace(/[▼▲►◄\s]/g, "").trim();
          const bidMatch = bidCleaned.match(
            /^(US\$|HK\$|RMB|EUR€?|GBP|JPY|AUD)(.+)$/
          );

          // Parse date MM/DD/YYYY → YYYY-MM-DD
          const dateMatch = dateRaw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);

          if (code && priceMatch && dateMatch) {
            data.push({
              fund_code: code,
              offer_price: parseFloat(priceMatch[2]),
              bid_price: bidMatch ? parseFloat(bidMatch[2]) : parseFloat(priceMatch[2]),
              valuation_date: `${dateMatch[3]}-${dateMatch[1]}-${dateMatch[2]}`,
              currency: priceMatch[1].replace("€", ""),  // EUR€ → EUR
              daily_change_pct: null,
            });
          }
        }
      }
      return data;
    });

    console.log(`[ilas-scraper] Scraped ${prices.length} fund prices`);

    if (prices.length === 0) {
      console.error("[ilas-scraper] No prices found — page may not have loaded");
      await browser.close();
      process.exit(1);
    }

    // POST to API
    console.log(`[ilas-scraper] Posting to ${API_URL}...`);
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CRON_SECRET}`,
      },
      body: JSON.stringify({ prices }),
    });

    const result = await res.json();
    console.log("[ilas-scraper] Result:", JSON.stringify(result, null, 2));

    await browser.close();
    process.exit(result.ok ? 0 : 1);
  } catch (err) {
    console.error("[ilas-scraper] Error:", err.message);
    await browser.close();
    process.exit(1);
  }
}

scrape();
