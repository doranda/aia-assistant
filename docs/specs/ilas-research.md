# AIA Hong Kong ILAS Deep Research

**Date:** 2026-03-27
**Purpose:** Comprehensive research on AIA's Investment-Linked Assurance Scheme (ILAS) products to inform the ILAS Track feature build.

---

## 1. What is ILAS?

An **Investment-Linked Assurance Scheme (ILAS)** is a long-term life insurance policy issued by an insurance company that combines:
- **Life insurance protection** (death benefit)
- **Investment component** (linked to underlying funds)

Key characteristics:
- It is a **Class C Long Term Business** insurance product under the Insurance Ordinance
- Premiums paid (after fees/charges) are used by the insurer to allocate **notional units** of investment options the policyholder selects
- The **insurance company owns the underlying assets** -- policyholders own only the policy itself, not the funds
- Policy value is determined by the insurance company based on the performance of underlying/reference funds
- Returns are subject to investment risks, market fluctuations, AND policy-level fees/charges
- Designed for **long-term holding** -- early surrender carries substantial charges (typically first 5-8 years)
- 21-day cooling-off period from policy delivery

**ILAS is legally a Collective Investment Scheme (CIS) under the Securities and Futures Ordinance (SFO).**

---

## 2. ILAS vs MPF: Key Differences

| Dimension | MPF | ILAS |
|---|---|---|
| **Purpose** | Mandatory retirement savings | Voluntary investment + insurance |
| **Regulator** | MPFA + SFC (dual) | SFC (product authorization) + IA (insurer regulation) + HKMA (bank distribution) |
| **Legal structure** | Trust-based retirement scheme | Insurance policy (Class C Long Term) |
| **Ownership** | Member owns units in trust | Insurer owns assets; policyholder owns notional units |
| **Fund universe** | ~20 funds per scheme (AIA has 20) | **100-200+ investment options** per scheme |
| **Fund selection** | Employer/trustee-selected, SFC-authorized | Policyholder chooses from SFC-authorized fund menu |
| **Currencies** | HKD only | USD, HKD, RMB, EUR, GBP, and more |
| **Settlement** | T+2 for daily NAV; switching takes ~3-5 business days | Varies by fund: T+1 to T+5+ (see section below) |
| **Switching** | Free and unlimited (SFC Code on MPF mandates no switching fees) | Typically free switches (varies by product; insurer may charge after a certain number) |
| **Fee structure** | Management fee + trustee fee (embedded in NAV) | Multiple layers: upfront charge, account value charge, COI, platform fee, surrender charge, PLUS underlying fund management fees |
| **Contribution** | Mandatory 5% employee + 5% employer (capped) | Flexible -- single premium or regular premium |
| **Access** | Locked until age 65 (with limited exceptions) | Withdrawable anytime (subject to surrender charges) |
| **Minimum allocation** | No minimum per fund; can allocate 1%+ | No minimum per fund typically; some have minimum remaining balance per option |
| **Tax treatment** | Tax-deductible TVC contributions | No tax deduction |
| **DIS (Default)** | Core Accumulation Fund / Age 65 Plus Fund (mandatory offering) | No equivalent; policyholder must actively choose |

### Settlement Model Differences (Critical for Engineering)

**MPF:**
- AIA publishes NAV prices T+2 business days
- Switching instruction → processed next business day → settled T+2 from instruction
- Single daily valuation point
- API: `getFundPerformance/MPF/` and `getFundPriceList/mpf` (working, confirmed)

**ILAS:**
- Each underlying fund has its own dealing/valuation cycle
- Settlement varies: equity funds typically T+3, bond funds T+2, money market T+1
- Instructions submitted by cut-off → processed on **next valuation day** of the specific fund
- Some funds have weekly or bi-weekly valuation only (not daily)
- Processing can be delayed by dealing restrictions in underlying fund offering documents
- Cross-currency settlement may add 1-2 additional days
- API: `getFundPerformance/ILAP/` returns **HTTP 400** -- endpoint exists but likely needs additional authentication or headers not present in the MPF endpoint

---

## 3. AIA ILAS Products (Schemes)

AIA International Limited (incorporated in Bermuda) offers the following SFC-authorized ILAS products in Hong Kong:

| Product Name | Premium Type | Policy Currency | Period with Surrender Charge |
|---|---|---|---|
| **Treasure Master Plus 2** (TMP2) | Single premium | USD / HKD / RMB | First 5 Policy Years |
| **Treasure Master Plus** (TMP) | Single premium | USD / HKD | First 5 Policy Years |
| **Wealth Elite 2** (WE2) | Single/Regular | USD / HKD / RMB | Varies |
| **2-in-1 Protection Linked Plan** (Regular) | Regular premium | USD / HKD | Varies |
| **2-in-1 Protection Linked Plan** (Single) | Single premium | USD / HKD | Varies |
| **U-Select** | Regular premium | USD / HKD | Varies |
| *Others (legacy/closed to new business)* | Various | Various | Various |

Each product has a different **investment options brochure** listing which funds are available under that specific scheme. Not all funds are available under all schemes.

### Treasure Master Plus 2 (TMP2) -- Key Facts (confirmed from Product KFS)

- **Upfront charge:** 1.35% p.a. (6.75% total of single premium)
- **Surrender charge:** Up to 6% of single premium for first 5 policy years
- **Account value charge:** Ongoing (deducted from policy value)
- **Cost of Insurance (COI):** Increases with age; deducted from policy value
- **Death benefit:** Higher of (100% premium - withdrawals) or (105% account value) before age 80; 105% account value after age 80
- **Minimum hold recommendation:** At least 8 years
- **Fund rebate:** Underlying fund managers may rebate up to 80% of their annual management fees to AIA

---

## 4. Fund Categories

Based on web research and the AIA website's fund type filters, ILAS funds fall into these categories:

| Category | Description | Example Funds |
|---|---|---|
| **Equity - Global** | Global/international equity | Global equity funds from various managers |
| **Equity - Asia Pacific** | Asia/Pacific region equity | Asian equity, ASEAN, Pacific Basin |
| **Equity - Greater China / HK** | China, HK, Taiwan equity | China equity, HK equity, Greater China |
| **Equity - North America** | US/Canada equity | US equity, North American growth |
| **Equity - Europe** | European equity | European equity, Eurozone |
| **Equity - Japan** | Japanese equity | Japan equity funds |
| **Equity - Sector/Thematic** | Technology, healthcare, ESG, etc. | Technology, green/ESG, healthcare |
| **Equity - Emerging Markets** | EM equity | EM equity, frontier markets |
| **Fixed Income - Global** | Global bonds | Global bond, global aggregate |
| **Fixed Income - Asia** | Asian bonds | Asian bond, Asian high yield |
| **Fixed Income - High Yield** | High yield/credit | High yield bond funds |
| **Money Market** | Cash/money market | HKD money market, USD money market |
| **Balanced / Mixed** | Multi-asset allocation | Balanced funds, managed funds |
| **Guaranteed** | Capital/return guarantee | Guaranteed return options |
| **Lifestyle / Target Date** | Age-based allocation | Similar to DIS but voluntary |
| **Alternative** | Commodities, REIT, etc. | Gold, property, commodities |

**Note:** The exact category taxonomy used by AIA's `CorpWS/Investment/Get/FundOptionType/` API was not extractable (returns HTML instead of JSON when called externally). The categories above are synthesized from AIA's website UI, product brochures, and IFEC educational materials.

The AIA website's fund search has three filter dimensions:
1. **Investment-Linked Assurance Scheme** (product/plan name)
2. **Management Company / Investment Manager** (fund house)
3. **Investment Option Name** (free text search)

---

## 5. Fund Houses / Managers

AIA's ILAS platform features funds from major global asset managers. Based on industry knowledge and AIA's partnership announcements:

**Confirmed / highly likely fund managers on AIA ILAS platform:**
- **BlackRock** (strategic partnership with AIA announced July 2024; Aladdin platform)
- **Fidelity International**
- **Schroders**
- **JPMorgan Asset Management**
- **Franklin Templeton**
- **Invesco**
- **Allianz Global Investors**
- **PIMCO** (fixed income specialist)
- **Aberdeen Standard Investments** (now abrdn)
- **Manulife Investment Management**
- **HSBC Asset Management**
- **UBS Asset Management**
- **Amundi**
- **AIA Investment Management** (AIA's in-house manager)

These are accessible via the `CorpWS/Investment/Get/FundHouse/` API endpoint (requires browser JS context).

---

## 6. Currencies

ILAS funds are denominated in multiple currencies:

| Currency | Usage |
|---|---|
| **USD** | Most common; majority of global/US equity and bond funds |
| **HKD** | HK equity funds, some money market, some bond funds |
| **RMB** (CNH/CNY) | China-focused funds, RMB money market |
| **EUR** | European equity/bond funds |
| **GBP** | Some UK/European funds |
| **JPY** | Japanese equity funds |
| **AUD** | Some Asia-Pacific funds |

**Policy currency** can be USD, HKD, or RMB (for TMP2). The underlying fund currency may differ from the policy currency, creating **foreign exchange risk**.

**Engineering implication:** Need a `currency` field per fund in `ilas_funds` table, and potentially FX rate tracking for portfolio NAV calculation in a unified base currency.

---

## 7. Settlement / Dealing Rules

### Cut-off Times (AIA e-Invest / AIA Connect)
- **Daily cut-off:** 5:15 PM HKT (paper form at office)
- **Extended cut-off (online):** 9:00 PM HKT
- **Exclusions:** Saturday and Public Holidays

### Processing Flow
1. Instruction received by 9:00 PM on a HK business day
2. Instruction accepted by AIA
3. Processed on the **next valuation day** (which may not be the next day if the underlying fund doesn't value daily)
4. Cancellation/allocation of units based on prices of the appropriate **Valuation Day of AIA**
5. For switches, the sell-side processes first, then buy-side processes on the next available valuation day of the target fund

### Settlement Timeline by Fund Type (estimated)
| Fund Type | Typical Settlement | Notes |
|---|---|---|
| Money Market | T+1 | Same-day or next business day |
| Bond Funds | T+2 to T+3 | Depends on underlying bond market |
| Equity - Developed | T+3 | Major markets (US, Europe, Japan) |
| Equity - Emerging | T+3 to T+5 | Some EM markets have longer settlement |
| Alternative/Property | T+5+ | Some property funds have weekly dealing |
| Guaranteed | T+3 to T+5 | May have additional processing requirements |

### Key Operational Notes (from AIA switching form)
- **Processing order:** Instructions processed on next dealing date AFTER approval
- **Deferral possible:** Subject to dealing restrictions in underlying fund offering documents
- **Transfers/switches:** Transaction not performed until latest valuation is confirmed OR notification letter issued (whichever is later)
- **Auto-rebalancing:** Automatically cancelled when a fund withdrawal request is accepted; must be re-enabled
- **Concurrent orders:** No restriction on having multiple pending orders (unlike MPF single-switch guard)
- **Risk profile:** If substantial change since last RPQ (valid 12 months), must submit new RPQ with switch request

---

## 8. Switching / Rebalancing Rules

### Free Switches
- Most AIA ILAS products offer **unlimited free switches** between investment options
- No switching fee charged by AIA at the policy level
- However, the underlying fund may have its own dealing charges (bid/offer spread)

### Minimum Balance Rules (TMP2)
- Minimum remaining balance per Investment Option (Cash Distribution) after withdrawal: **US$2,000 or HK$16,000 or RMB14,000**
- Other minimums may apply per product

### How Switching Works
1. Policyholder submits switch instruction (online via AIA+ / AIA Connect, or paper form)
2. AIA sells units in the source investment option at the **bid price** on the next valuation day
3. AIA buys units in the target investment option at the **offer price** on the next valuation day
4. If source and target funds have different valuation days, there may be a gap (cash float)
5. Confirmation letter sent after completion

### Allocation Changes
- Can change future premium allocation (for regular premium plans) separately from switching existing units
- Allocation change applies to future premiums only; existing units unchanged

---

## 9. Number of Funds

**Estimated: 100-200+ investment options across all AIA ILAS schemes.**

Evidence:
- AIA's Robotic Investment Choice Service references "more than 120 Reference Portfolios" (these are model portfolios, not individual funds, but suggests a large fund universe)
- The implementation plan estimates ~100+ funds
- Industry comparison: major ILAS providers in HK typically offer 80-200 underlying fund options
- Each scheme (TMP2, WE2, U-Select, etc.) may have a different subset of the full fund menu
- SFC FAQ confirms individual investment options can be authorized and shared across multiple ILAS products from the same insurer

**Exact count can only be determined by:**
1. Hitting the AIA ILAS API (currently returning 400 -- needs investigation)
2. Scraping the AIA website with a browser (the CorpWS endpoints need JS context)
3. Requesting the Investment Options Brochure from AIA directly

---

## 10. Data Sources for Daily NAV Prices

### Primary: AIA's Own API
- **MPF endpoint (working):** `https://www3.aia-pt.com.hk/common_ws/aiapt/FundPrice/getFundPerformance/MPF/`
- **ILAS endpoint (returning 400):** `https://www3.aia-pt.com.hk/common_ws/aiapt/FundPrice/getFundPerformance/ILAP/`
- **ILAS price list (returning 400):** `https://www3.aia-pt.com.hk/common_ws/aiapt/FundPrice/getFundPriceList/ILAP`
- The ILAP endpoints likely need additional headers, cookies, or authentication not required by the MPF endpoint
- **AIA website CorpWS API:** `https://www.aia.com.hk/CorpWS/Investment/Get/FundScheme/`, `FundHouse/`, `FundOptionType/` -- these return data in the browser but need JS/session context

### Secondary: Fund House Websites
Each underlying fund manager publishes their own NAV data:
- BlackRock: blackrock.com/hk fund pages
- Fidelity: fidelity.com.hk fund prices
- Schroders: schroders.com/hk
- JPMorgan: am.jpmorgan.com/hk
- Franklin Templeton: franklintempleton.com.hk
- Each has their own update schedule (typically T+1 for developed market funds)

### Tertiary: Data Aggregators
- **Morningstar:** morningstar.com.hk -- comprehensive fund data, requires subscription for API
- **FE FundInfo:** fe.fundinfo.com -- widely used in HK insurance industry
- **Bloomberg Terminal:** Professional-grade but expensive ($24K+/year)
- **Refinitiv (LSEG):** Fund data feeds

### AIA Investment Website
- `https://investment.aia.com/hk/en/index.html` -- AIA Investment Management's own site
- May have separate API endpoints for AIA-managed funds specifically

---

## 11. Regulatory Framework

### Dual Authorization
1. **SFC** authorizes the ILAS scheme, offering documents, and marketing materials under Section 104 of the SFO
2. **Insurance Authority (IA)** authorizes and regulates the insurance company issuing the policy

### SFC ILAS Code (effective January 2019)
Key provisions from the SFC Code on Investment-Linked Assurance Schemes:
- Investment options may link to **SFC-authorized retail funds** or internally managed pools
- **Illustration document** mandatory before signing -- must show surrender values at end of each of first 5 years, then every 5th year
- **Product Key Facts Statement (KFS)** required at scheme level
- **Cooling-off period** mandated (21 days); MVA (Market Value Adjustment) may apply but cannot include expenses/commissions
- Offering document must be in **English and Chinese**
- **Performance fee** restrictions: no more than annually, high-on-high basis only
- For funds managed by same group: initial charges waived, only recurrent management fees charged

### 2021 Tightened Regulation (SFC)
- Insurance fees cannot exceed charges for ordinary term life products
- Fund fees must not surpass fees on regular fund platforms
- Low surrender fees required for policies with minimal life protection
- Greater transparency on fee structures
- 18-month transition for existing products
- Market at time: 49 ILAS products, 31 insurance companies, 1.2 million policies, ~US$39.2 billion AUM

### IA Requirements
- Product design review
- Clarity of policy documents
- Remuneration structure and disclosure
- Sales process controls
- Post-sale controls

---

## 12. Implications for ILAS Track Implementation

### Categories Need Revision
The current plan uses: `global_equity, asia_equity, hk_china_equity, sector_equity, bond, money_market, balanced, guaranteed, lifestyle`

**Recommended expanded categories:**
```
equity_global, equity_asia, equity_hk_china, equity_us, equity_europe, equity_japan,
equity_sector, equity_em,
bond_global, bond_asia, bond_high_yield,
money_market,
balanced, guaranteed, lifestyle, alternative
```

### ILAS API Issue
The `ILAP` API endpoints return 400. Options:
1. **Use browser automation (Playwright)** to hit the CorpWS endpoints and extract scheme/fund/house data
2. **Investigate ILAP API headers** -- compare request headers between MPF (works) and ILAP (fails). May need a session cookie or specific Referer header
3. **Scrape the AIA investment options page** with Playwright to get the full fund list with codes
4. **Request data directly from AIA** as a distribution partner

### Settlement Per Fund
Each fund needs its own `settlement_days` in the database. Cannot use a global constant like MPF.

### Currency Handling
Need `currency` field per fund. Portfolio NAV should be calculated in a single base currency (USD recommended) with FX conversion.

### Larger UI Requirements
100-200 funds vs 20 MPF funds means:
- Category-grouped views (not flat list)
- Search/filter/pagination
- Fund screener with multiple filter dimensions
- Performance heatmap grouped by category

---

## Sources

- [AIA ILAS Products Page](https://www.aia.com.hk/en/our-products/investment-linked-assurance-scheme.html)
- [AIA Investment Options & Prices](https://www.aia.com.hk/en/help-and-support/individuals/investment-information/investment-options-prices.html)
- [AIA Treasure Master Plus 2](https://www.aia.com.hk/en/products/invest/treasure-master-plus-2)
- [AIA Valuation Day Info](https://www.aia.com.hk/en/products/invest/investment-information/valuation-day)
- [AIA Fund Switching via AIA+](https://www.aia.com.hk/en/help-and-support/aia-plus/guides-resources/user-guides-and-resources/policy-account/fund-switching)
- [IFEC - Understanding ILAS](https://www.ifec.org.hk/web/en/financial-products/insurance/product-types/ilas/basics/understanding-ilas.page)
- [IFEC - ILAS Regulation Overview](https://www.ifec.org.hk/web/en/financial-products/insurance/product-types/ilas/regulation/overview.page)
- [SFC Code on ILAS (Section III)](https://www.sfc.hk/-/media/EN/assets/components/codes/files-current/web/codes/section-iii-code-on-investment-linked-assurance-schemes/section-iii-code-on-investment-linked-assurance-schemes.pdf)
- [SFC ILAS FAQ](https://www.sfc.hk/en/faqs/Publicly-offered-investment-products/Investment-Linked-Assurance-Schemes)
- [SCMP - SFC Tightens ILAS Regulation (2021)](https://www.scmp.com/business/banking-finance/article/3154479/sfc-tightens-regulation-investment-linked-insurance)
- [BlackRock + BNY + AIA Partnership](https://www.blackrock.com/aladdin/discover/aia-announces-collaboration-with-blackrock-and-bny)
- [AIA Switching Form (OPPOSF17)](https://www.aia.com.hk/content/dam/hk-wise/pdf/form-library/form-individual/policy-administration/OPPOSF17-0923.pdf)
- [TMP2 Product Key Facts Statement](https://www.aia.com.hk/content/dam/hk-wise/pdf/products/individuals/en/treasure-master-plus-2/TreasureMasterPlus2_HK_en.pdf)
