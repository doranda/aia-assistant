// src/lib/ilas/constants.ts — Static ILAS configuration

import type { IlasFundCategory, IlasRiskLevel, FundAllocation } from './types';

// ===== Category Mapping =====
// Maps AIA's display names to our enum values

export const ILAS_CATEGORY_MAP: Record<string, IlasFundCategory> = {
  'Equity - Asia Pacific': 'equity_asia_pacific',
  'Equity - China & Hong Kong': 'equity_china_hk',
  'Equity - Emerging Markets': 'equity_emerging_markets',
  'Equity - Europe': 'equity_europe',
  'Equity - Global': 'equity_global',
  'Equity - Sector': 'equity_sector',
  'Equity - US': 'equity_us',
  'Fixed Income - Asia Pacific': 'fixed_income_asia_pacific',
  'Fixed Income - China & Hong Kong': 'fixed_income_china_hk',
  'Fixed Income - Emerging Markets': 'fixed_income_emerging_markets',
  'Fixed Income - Global': 'fixed_income_global',
  'Fixed Income - US': 'fixed_income_us',
  'Liquidity / Money Market': 'liquidity_money_market',
  'Multi-Assets - Asia Pacific': 'multi_assets_asia_pacific',
  'Multi-Assets - Global': 'multi_assets_global',
  'Multi-Assets - US': 'multi_assets_us',
};

// Human-readable labels for each category
export const ILAS_CATEGORY_LABELS: Record<IlasFundCategory, string> = {
  equity_asia_pacific: 'Equity - Asia Pacific',
  equity_china_hk: 'Equity - China & Hong Kong',
  equity_emerging_markets: 'Equity - Emerging Markets',
  equity_europe: 'Equity - Europe',
  equity_global: 'Equity - Global',
  equity_sector: 'Equity - Sector',
  equity_us: 'Equity - US',
  fixed_income_asia_pacific: 'Fixed Income - Asia Pacific',
  fixed_income_china_hk: 'Fixed Income - China & Hong Kong',
  fixed_income_emerging_markets: 'Fixed Income - Emerging Markets',
  fixed_income_global: 'Fixed Income - Global',
  fixed_income_us: 'Fixed Income - US',
  liquidity_money_market: 'Liquidity / Money Market',
  multi_assets_asia_pacific: 'Multi-Assets - Asia Pacific',
  multi_assets_global: 'Multi-Assets - Global',
  multi_assets_us: 'Multi-Assets - US',
};

// ===== All 142 active AIA ILAS funds =====
// Source: AIA ILAS Fund Price page (verified 2026-03-27)
// Z-prefix codes = distribution share classes

export const AIA_ILAS_FUNDS = [
  { fund_code: 'B01', aia_fund_code: 'B01', name_en: 'AB FCP I - Short Duration Bond Portfolio "A2"', category: 'fixed_income_global' as IlasFundCategory, risk_rating: 'Low' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'AllianceBernstein (Luxembourg) S.a.r.l.', fund_size: 'US$402.5' },
  { fund_code: 'C05', aia_fund_code: 'C05', name_en: 'abrdn SICAV I - All China Sustainable Equity Fund "A2"', category: 'equity_china_hk' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'abrdn Investments Luxembourg S.A.', fund_size: 'US$345.3' },
  { fund_code: 'C03', aia_fund_code: 'C03', name_en: 'abrdn SICAV I - Emerging Markets Bond Fund "A2"', category: 'fixed_income_emerging_markets' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'abrdn Investments Luxembourg S.A.', fund_size: 'US$319.5' },
  { fund_code: 'C09', aia_fund_code: 'C09', name_en: 'abrdn SICAV I - Emerging Markets Corporate Bond Fund "A2"', category: 'fixed_income_emerging_markets' as IlasFundCategory, risk_rating: 'Low' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'abrdn Investments Luxembourg S.A.', fund_size: 'US$1301.7' },
  { fund_code: 'Z69', aia_fund_code: 'Z69', name_en: 'abrdn SICAV I - Emerging Markets Corporate Bond Fund Class A Fixed MIncA USD (Dis)', category: 'fixed_income_emerging_markets' as IlasFundCategory, risk_rating: 'Low' as IlasRiskLevel, currency: 'USD', is_distribution: true, fund_house: 'abrdn Investments Luxembourg S.A.', fund_size: 'US$1301.7' },
  { fund_code: 'R51', aia_fund_code: 'R51', name_en: 'AIA Investment Funds - AIA Equity Income Fund (Class R USD)', category: 'equity_global' as IlasFundCategory, risk_rating: 'Medium' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'FundRock Management Company S.A.', fund_size: 'US$1105.6' },
  { fund_code: 'Z51', aia_fund_code: 'Z51', name_en: 'AIA Investment Funds - AIA Equity Income Fund (Class RDM USD) (Dis)', category: 'equity_global' as IlasFundCategory, risk_rating: 'Medium' as IlasRiskLevel, currency: 'USD', is_distribution: true, fund_house: 'FundRock Management Company S.A.', fund_size: 'US$1105.6' },
  { fund_code: 'R52', aia_fund_code: 'R52', name_en: 'AIA Investment Funds - AIA US High Yield Bond Fund (Class R USD)', category: 'fixed_income_us' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'FundRock Management Company S.A.', fund_size: 'US$185.4' },
  { fund_code: 'Z52', aia_fund_code: 'Z52', name_en: 'AIA Investment Funds - AIA US High Yield Bond Fund (Class RDM USD) (Dis)', category: 'fixed_income_us' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: true, fund_house: 'FundRock Management Company S.A.', fund_size: 'US$185.4' },
  { fund_code: 'P05', aia_fund_code: 'P05', name_en: 'Allianz Asia Pacific Income "A"', category: 'multi_assets_asia_pacific' as IlasFundCategory, risk_rating: 'Low' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'Allianz Global Investors GmbH', fund_size: 'US$34.8' },
  { fund_code: 'P29', aia_fund_code: 'P29', name_en: 'Allianz Global Investors Fund - Allianz China A-Shares Accumulation Shares (Class AT) (RMB)', category: 'equity_china_hk' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'RMB', is_distribution: false, fund_house: 'Allianz Global Investors GmbH', fund_size: 'US$2909.1' },
  { fund_code: 'P09', aia_fund_code: 'P09', name_en: 'Allianz Global Investors Fund - Allianz China A-Shares Accumulation Shares (Class AT) (USD)', category: 'equity_china_hk' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'Allianz Global Investors GmbH', fund_size: 'US$2909.1' },
  { fund_code: 'P08', aia_fund_code: 'P08', name_en: 'Allianz Global Investors Fund - Allianz Dynamic Asian High Yield Bond Accumulation Shares (Class AT)', category: 'fixed_income_asia_pacific' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'Allianz Global Investors GmbH', fund_size: 'US$658.1' },
  { fund_code: 'Z08', aia_fund_code: 'Z08', name_en: 'Allianz Global Investors Fund - Allianz Dynamic Asian High Yield Bond Distribution Shares (Class AMg) (Dis)', category: 'fixed_income_asia_pacific' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: true, fund_house: 'Allianz Global Investors GmbH', fund_size: 'US$658.1' },
  { fund_code: 'P07', aia_fund_code: 'P07', name_en: 'Allianz Global Investors Fund - Allianz Income and Growth Accumulation Shares (Class AT)', category: 'multi_assets_us' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'Allianz Global Investors GmbH', fund_size: 'US$56773.0' },
  { fund_code: 'Z07', aia_fund_code: 'Z07', name_en: 'Allianz Global Investors Fund - Allianz Income and Growth Class Distribution Shares (Class AM) (Dis)', category: 'multi_assets_us' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: true, fund_house: 'Allianz Global Investors GmbH', fund_size: 'US$56773.0' },
  { fund_code: 'Z27', aia_fund_code: 'Z27', name_en: 'Allianz Global Investors Fund - Allianz Income and Growth Class Distribution Shares (Class AM) H2 RMB (Dis)', category: 'multi_assets_us' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'RMB', is_distribution: true, fund_house: 'Allianz Global Investors GmbH', fund_size: 'US$56773.0' },
  { fund_code: 'P03', aia_fund_code: 'P03', name_en: 'Allianz Oriental Income "AT"', category: 'multi_assets_asia_pacific' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'Allianz Global Investors GmbH', fund_size: 'US$1700.4' },
  { fund_code: 'P04', aia_fund_code: 'P04', name_en: 'Allianz Total Return Asian Equity "AT"', category: 'equity_asia_pacific' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'Allianz Global Investors GmbH', fund_size: 'US$372.3' },
  { fund_code: 'W04', aia_fund_code: 'W04', name_en: 'Amundi Funds - Cash USD "A2 USD Class"', category: 'liquidity_money_market' as IlasFundCategory, risk_rating: 'Low' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'Amundi Luxembourg S.A.', fund_size: 'US$5088.8' },
  { fund_code: 'Z66', aia_fund_code: 'Z66', name_en: 'Amundi Funds - US Short Term Bond A2 RMB Hgd-MTD3 (D) (Dis)', category: 'fixed_income_us' as IlasFundCategory, risk_rating: 'Low' as IlasRiskLevel, currency: 'RMB', is_distribution: true, fund_house: 'Amundi Luxembourg S.A.', fund_size: 'US$2339.6' },
  { fund_code: 'W06', aia_fund_code: 'W06', name_en: 'Amundi Funds - US Short Term Bond A2 USD (C)', category: 'fixed_income_us' as IlasFundCategory, risk_rating: 'Low' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'Amundi Luxembourg S.A.', fund_size: 'US$2339.6' },
  { fund_code: 'Z36', aia_fund_code: 'Z36', name_en: 'Amundi Funds - US Short Term Bond A2 USD MTD3 (D) (Dis)', category: 'fixed_income_us' as IlasFundCategory, risk_rating: 'Low' as IlasRiskLevel, currency: 'USD', is_distribution: true, fund_house: 'Amundi Luxembourg S.A.', fund_size: 'US$2339.6' },
  { fund_code: 'X02', aia_fund_code: 'X02', name_en: 'Barings Australia Fund "A"', category: 'equity_asia_pacific' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'Baring International Fund Managers (Ireland) Limited', fund_size: 'US$58.5' },
  { fund_code: 'X08', aia_fund_code: 'X08', name_en: 'Barings Emerging Markets Umbrella Fund - Barings Global Emerging Markets Fund Class A USD Acc', category: 'equity_emerging_markets' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'Baring International Fund Managers (Ireland) Limited', fund_size: 'US$714.1' },
  { fund_code: 'X03', aia_fund_code: 'X03', name_en: 'Barings Global Resources Fund', category: 'equity_sector' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'Baring International Fund Managers (Ireland) Limited', fund_size: 'US$280.6' },
  { fund_code: 'Z25', aia_fund_code: 'Z25', name_en: 'Barings Umbrella Fund plc - Barings Global High Yield Bond Fund Class G RMB Hedged Dist Mth (Dis)', category: 'fixed_income_global' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'RMB', is_distribution: true, fund_house: 'Baring International Fund Managers (Ireland) Limited', fund_size: 'US$4471.3' },
  { fund_code: 'X15', aia_fund_code: 'X15', name_en: 'Barings Umbrella Fund plc - Barings Global High Yield Bond Fund Class G USD Acc', category: 'fixed_income_global' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'Baring International Fund Managers (Ireland) Limited', fund_size: 'US$4471.3' },
  { fund_code: 'Z15', aia_fund_code: 'Z15', name_en: 'Barings Umbrella Fund plc - Barings Global High Yield Bond Fund Class G USD Dist Mth (Dis)', category: 'fixed_income_global' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: true, fund_house: 'Baring International Fund Managers (Ireland) Limited', fund_size: 'US$4471.3' },
  { fund_code: 'I27', aia_fund_code: 'I27', name_en: 'BlackRock Global Funds - Asian Tiger Bond Fund "A2"', category: 'fixed_income_asia_pacific' as IlasFundCategory, risk_rating: 'Low' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'BlackRock (Luxembourg) S.A.', fund_size: 'US$2170.1' },
  { fund_code: 'I28', aia_fund_code: 'I28', name_en: 'BlackRock Global Funds - Global High Yield Bond Fund "A2"', category: 'fixed_income_global' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'BlackRock (Luxembourg) S.A.', fund_size: 'US$1956.7' },
  { fund_code: 'I10', aia_fund_code: 'I10', name_en: 'BlackRock Global Funds - Latin American Fund "A2"', category: 'equity_emerging_markets' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'BlackRock (Luxembourg) S.A.', fund_size: 'US$731.8' },
  { fund_code: 'I21', aia_fund_code: 'I21', name_en: 'BlackRock Global Funds - Sustainable Energy Fund "A2"', category: 'equity_sector' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'BlackRock (Luxembourg) S.A.', fund_size: 'US$4521.0' },
  { fund_code: 'Z37', aia_fund_code: 'Z37', name_en: 'BlackRock Global Funds - Systematic Global Equity High Income Fund "A8" Hedged RMB (Dis)', category: 'equity_global' as IlasFundCategory, risk_rating: 'Medium' as IlasRiskLevel, currency: 'RMB', is_distribution: true, fund_house: 'BlackRock (Luxembourg) S.A.', fund_size: 'US$12302.5' },
  { fund_code: 'I17', aia_fund_code: 'I17', name_en: 'BlackRock Global Funds - Systematic Global Equity High Income Fund "A2"', category: 'equity_global' as IlasFundCategory, risk_rating: 'Low' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'BlackRock (Luxembourg) S.A.', fund_size: 'US$12302.5' },
  { fund_code: 'Z17', aia_fund_code: 'Z17', name_en: 'BlackRock Global Funds - Systematic Global Equity High Income Fund "A6" (Dis)', category: 'equity_global' as IlasFundCategory, risk_rating: 'Low' as IlasRiskLevel, currency: 'USD', is_distribution: true, fund_house: 'BlackRock (Luxembourg) S.A.', fund_size: 'US$12302.5' },
  { fund_code: 'I23', aia_fund_code: 'I23', name_en: 'BlackRock Global Funds - US Basic Value Fund "A2"', category: 'equity_us' as IlasFundCategory, risk_rating: 'Medium' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'BlackRock (Luxembourg) S.A.', fund_size: 'US$925.7' },
  { fund_code: 'I09', aia_fund_code: 'I09', name_en: 'BlackRock Global Funds - World Energy Fund "A2"', category: 'equity_sector' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'BlackRock (Luxembourg) S.A.', fund_size: 'US$1835.0' },
  { fund_code: 'I07', aia_fund_code: 'I07', name_en: 'BlackRock Global Funds - World Gold Fund "A2"', category: 'equity_sector' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'BlackRock (Luxembourg) S.A.', fund_size: 'US$12425.3' },
  { fund_code: 'I31', aia_fund_code: 'I31', name_en: 'BlackRock Global Funds - World Healthscience Fund "A2"', category: 'equity_sector' as IlasFundCategory, risk_rating: 'Medium' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'BlackRock (Luxembourg) S.A.', fund_size: 'US$13623.8' },
  { fund_code: 'I04', aia_fund_code: 'I04', name_en: 'BlackRock Global Funds - World Mining Fund "A2"', category: 'equity_sector' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'BlackRock (Luxembourg) S.A.', fund_size: 'US$7445.2' },
  { fund_code: 'T09', aia_fund_code: 'T09', name_en: 'BNP Paribas Funds Clean Energy Solutions "CC"', category: 'equity_sector' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'BNP Paribas Asset Management Luxembourg', fund_size: 'US$1207.8' },
  { fund_code: 'CG9', aia_fund_code: 'CG9', name_en: 'Capital International Fund - Capital Group Global Corporate Bond Fund (LUX) B USD', category: 'fixed_income_global' as IlasFundCategory, risk_rating: 'Low' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'Capital International Management Company', fund_size: 'US$6507.1' },
  { fund_code: 'Z29', aia_fund_code: 'Z29', name_en: 'Capital International Fund - Capital Group Global Corporate Bond Fund (LUX) Bfdm USD (Dis)', category: 'fixed_income_global' as IlasFundCategory, risk_rating: 'Low' as IlasRiskLevel, currency: 'USD', is_distribution: true, fund_house: 'Capital International Management Company', fund_size: 'US$6507.1' },
  { fund_code: 'Z39', aia_fund_code: 'Z39', name_en: 'Capital International Fund - Capital Group Global Corporate Bond Fund (LUX) Bfdmh-CNH (Dis)', category: 'fixed_income_global' as IlasFundCategory, risk_rating: 'Low' as IlasRiskLevel, currency: 'RMB', is_distribution: true, fund_house: 'Capital International Management Company', fund_size: 'US$6507.0' },
  { fund_code: 'CG1', aia_fund_code: 'CG1', name_en: 'Capital International Fund - Capital Group New Perspective Fund (LUX) B USD', category: 'equity_global' as IlasFundCategory, risk_rating: 'Medium' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'Capital International Management Company', fund_size: 'US$20447.2' },
  { fund_code: 'M01', aia_fund_code: 'M01', name_en: 'Fidelity Funds - America Fund "A"', category: 'equity_us' as IlasFundCategory, risk_rating: 'Medium' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'FIL Investment Management (Luxembourg) S.A.', fund_size: 'US$2878.4' },
  { fund_code: 'M15', aia_fund_code: 'M15', name_en: 'Fidelity Funds - Asia Equity ESG Fund - Class A - Acc - USD', category: 'equity_asia_pacific' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'FIL Investment Management (Luxembourg) S.A.', fund_size: 'US$3334.3' },
  { fund_code: 'M06', aia_fund_code: 'M06', name_en: 'Fidelity Funds - Asian Special Situations Fund "A"', category: 'equity_asia_pacific' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'FIL Investment Management (Luxembourg) S.A.', fund_size: 'US$2206.1' },
  { fund_code: 'M08', aia_fund_code: 'M08', name_en: 'Fidelity Funds - China Consumer Fund "A-ACC"', category: 'equity_china_hk' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'FIL Investment Management (Luxembourg) S.A.', fund_size: 'US$3053.1' },
  { fund_code: 'M11', aia_fund_code: 'M11', name_en: 'Fidelity Funds - Global Bond Fund - Class A-Acc-USD', category: 'fixed_income_global' as IlasFundCategory, risk_rating: 'Low' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'FIL Investment Management (Luxembourg) S.A.', fund_size: 'US$1456.8' },
  { fund_code: 'M13', aia_fund_code: 'M13', name_en: 'Fidelity Funds - US Dollar Cash Fund - Class A - Acc - USD', category: 'liquidity_money_market' as IlasFundCategory, risk_rating: 'Low' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'FIL Investment Management (Luxembourg) S.A.', fund_size: 'US$2924.4' },
  { fund_code: 'M10', aia_fund_code: 'M10', name_en: 'Fidelity Funds - US High Yield Fund Class A-ACC-USD', category: 'fixed_income_us' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'FIL Investment Management (Luxembourg) S.A.', fund_size: 'US$2637.7' },
  { fund_code: 'Z13', aia_fund_code: 'Z13', name_en: 'Fidelity Funds - US High Yield Fund Class A-MINCOME(G)-USD (Dis)', category: 'fixed_income_us' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: true, fund_house: 'FIL Investment Management (Luxembourg) S.A.', fund_size: 'US$2637.7' },
  { fund_code: 'Q02', aia_fund_code: 'Q02', name_en: 'First Sentier Investors Global Umbrella Fund plc - First Sentier Asia Strategic Bond Fund', category: 'fixed_income_asia_pacific' as IlasFundCategory, risk_rating: 'Medium' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'First Sentier Investors (Ireland) Limited', fund_size: 'US$33.7' },
  { fund_code: 'Q01', aia_fund_code: 'Q01', name_en: 'First Sentier Investors Global Umbrella Fund plc - FSSA Asian Equity Plus Fund (Class I Distributing)', category: 'equity_asia_pacific' as IlasFundCategory, risk_rating: 'Medium' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'First Sentier Investors (Ireland) Limited', fund_size: 'US$5692.0' },
  { fund_code: 'Q03', aia_fund_code: 'Q03', name_en: 'First Sentier Investors Global Umbrella Fund plc - FSSA China Growth Fund (Class I)', category: 'equity_china_hk' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'First Sentier Investors (Ireland) Limited', fund_size: 'US$2771.0' },
  { fund_code: 'L52', aia_fund_code: 'L52', name_en: 'Franklin Templeton Global Funds plc - FTGF Royce US Small Cap Opportunity Fund - Class A ACC', category: 'equity_us' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'Franklin Templeton International Services S.á r.l.', fund_size: 'US$1051.1' },
  { fund_code: 'L51', aia_fund_code: 'L51', name_en: 'Franklin Templeton Global Funds plc - FTGF Western Asset Asian Opportunities Fund - Class A ACC', category: 'fixed_income_asia_pacific' as IlasFundCategory, risk_rating: 'Low' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'Franklin Templeton International Services S.á r.l.', fund_size: 'US$121.4' },
  { fund_code: 'ZL1', aia_fund_code: 'ZL1', name_en: 'Franklin Templeton Global Funds plc - FTGF Western Asset Asian Opportunities Fund Class A US$ Distributing (M) Plus (Dis)', category: 'fixed_income_asia_pacific' as IlasFundCategory, risk_rating: 'Low' as IlasRiskLevel, currency: 'USD', is_distribution: true, fund_house: 'Franklin Templeton International Services S.á r.l.', fund_size: 'US$121.4' },
  { fund_code: 'D05', aia_fund_code: 'D05', name_en: 'Franklin Templeton Investment Funds - Franklin Biotechnology Discovery Fund A "Acc"', category: 'equity_sector' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'Franklin Templeton International Services S.á r.l.', fund_size: 'US$1783.5' },
  { fund_code: 'D14', aia_fund_code: 'D14', name_en: 'Franklin Templeton Investment Funds - Franklin Gold and Precious Metals Fund A "Acc"', category: 'equity_sector' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'Franklin Templeton International Services S.á r.l.', fund_size: 'US$2087.8' },
  { fund_code: 'Z28', aia_fund_code: 'Z28', name_en: 'Franklin Templeton Investment Funds - Franklin Income Fund - A (Mdirc) RMB - H1 (Dis)', category: 'multi_assets_us' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'RMB', is_distribution: true, fund_house: 'Franklin Templeton International Services S.á r.l.', fund_size: 'US$10849.3' },
  { fund_code: 'D18', aia_fund_code: 'D18', name_en: 'Franklin Templeton Investment Funds - Franklin Income Fund - A Acc USD', category: 'multi_assets_us' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'Franklin Templeton International Services S.á r.l.', fund_size: 'US$10849.3' },
  { fund_code: 'Z18', aia_fund_code: 'Z18', name_en: 'Franklin Templeton Investment Funds - Franklin Income Fund - A MDis USD (Dis)', category: 'multi_assets_us' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: true, fund_house: 'Franklin Templeton International Services S.á r.l.', fund_size: 'US$10849.3' },
  { fund_code: 'D08', aia_fund_code: 'D08', name_en: 'Franklin Templeton Investment Funds - Templeton Eastern Europe Fund A "Acc"', category: 'equity_emerging_markets' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'EUR', is_distribution: false, fund_house: 'Franklin Templeton International Services S.á r.l.', fund_size: 'US$183.0' },
  { fund_code: 'D02', aia_fund_code: 'D02', name_en: 'Franklin Templeton Investment Funds - Templeton European Insights Fund A "Acc"', category: 'equity_europe' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'EUR', is_distribution: false, fund_house: 'Franklin Templeton International Services S.á r.l.', fund_size: 'US$505.2' },
  { fund_code: 'GG', aia_fund_code: 'GG', name_en: 'Franklin Templeton Investment Funds - Templeton Global Fund A "Acc"', category: 'equity_global' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'Franklin Templeton International Services S.á r.l.', fund_size: 'US$602.8' },
  { fund_code: 'G08', aia_fund_code: 'G08', name_en: 'HSBC Global Investment Funds - Brazil Equity "AD"', category: 'equity_emerging_markets' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'HSBC Investment Funds (Luxembourg) S.A.', fund_size: 'US$178.2' },
  { fund_code: 'G07', aia_fund_code: 'G07', name_en: 'HSBC Global Investment Funds - BRIC Markets Equity "AC"', category: 'equity_emerging_markets' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'HSBC Investment Funds (Luxembourg) S.A.', fund_size: 'US$43.0' },
  { fund_code: 'G03', aia_fund_code: 'G03', name_en: 'HSBC Global Investment Funds - Chinese Equity "AD"', category: 'equity_china_hk' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'HSBC Investment Funds (Luxembourg) S.A.', fund_size: 'US$821.4' },
  { fund_code: 'G16', aia_fund_code: 'G16', name_en: 'HSBC Investment Funds Trust - HSBC Asian High Yield Bond AC USD', category: 'fixed_income_asia_pacific' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'HSBC Investment Funds (Hong Kong) Limited', fund_size: 'US$782.7' },
  { fund_code: 'Z16', aia_fund_code: 'Z16', name_en: 'HSBC Investment Funds Trust - HSBC Asian High Yield Bond AM2-USD (Dis)', category: 'fixed_income_asia_pacific' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: true, fund_house: 'HSBC Investment Funds (Hong Kong) Limited', fund_size: 'US$782.7' },
  { fund_code: 'Z26', aia_fund_code: 'Z26', name_en: 'HSBC Investment Funds Trust - HSBC Asian High Yield Bond AM3H-RMB (Dis)', category: 'fixed_income_asia_pacific' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'RMB', is_distribution: true, fund_house: 'HSBC Investment Funds (Hong Kong) Limited', fund_size: 'US$782.7' },
  { fund_code: 'E05', aia_fund_code: 'E05', name_en: 'Invesco Euro Ultra-Short Term Debt Fund - "A" share', category: 'fixed_income_global' as IlasFundCategory, risk_rating: 'Low' as IlasRiskLevel, currency: 'EUR', is_distribution: false, fund_house: 'Invesco Management S.A.', fund_size: 'US$437.3' },
  { fund_code: 'R03', aia_fund_code: 'R03', name_en: 'Janus Henderson Capital Funds plc - Janus Henderson Balanced Fund - Class A2 USD', category: 'multi_assets_us' as IlasFundCategory, risk_rating: 'Low' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'Janus Henderson Investors Europe S.A.', fund_size: 'US$11739.7' },
  { fund_code: 'Z33', aia_fund_code: 'Z33', name_en: 'Janus Henderson Capital Funds plc - Janus Henderson Balanced Fund Class A6m USD (Dis)', category: 'multi_assets_us' as IlasFundCategory, risk_rating: 'Low' as IlasRiskLevel, currency: 'USD', is_distribution: true, fund_house: 'Janus Henderson Investors Europe S.A.', fund_size: 'US$11739.7' },
  { fund_code: 'R01', aia_fund_code: 'R01', name_en: 'Janus Henderson Capital Funds plc - Janus Henderson Global Real Estate Equity Income Fund "A acc"', category: 'equity_sector' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'Janus Henderson Investors Europe S.A.', fund_size: 'US$177.9' },
  { fund_code: 'Z31', aia_fund_code: 'Z31', name_en: 'Janus Henderson Capital Funds plc - Janus Henderson Global Real Estate Equity Income Fund Class A5m USD (Dis)', category: 'equity_sector' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: true, fund_house: 'Janus Henderson Investors Europe S.A.', fund_size: 'US$177.9' },
  { fund_code: 'H01', aia_fund_code: 'H01', name_en: 'Janus Henderson Horizon Fund - Global Technology Leaders Fund "A2"', category: 'equity_sector' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'Janus Henderson Investors Europe S.A.', fund_size: 'US$6336.7' },
  { fund_code: 'Z23', aia_fund_code: 'Z23', name_en: 'JPM - Asia Pacific Income Fund A (irc) - RMBH share class (Dis)', category: 'multi_assets_asia_pacific' as IlasFundCategory, risk_rating: 'Medium' as IlasRiskLevel, currency: 'RMB', is_distribution: true, fund_house: 'JPMorgan Asset Management (Europe) S.á r.l.', fund_size: 'US$1529.1' },
  { fund_code: 'Z03', aia_fund_code: 'Z03', name_en: 'JPM - Asia Pacific Income Fund A (mth) - USD share class (Dis)', category: 'multi_assets_asia_pacific' as IlasFundCategory, risk_rating: 'Low' as IlasRiskLevel, currency: 'USD', is_distribution: true, fund_house: 'JPMorgan Asset Management (Europe) S.á r.l.', fund_size: 'US$1529.1' },
  { fund_code: 'F14', aia_fund_code: 'F14', name_en: 'JPM Asia Pacific Income "A (acc) - USD"', category: 'multi_assets_asia_pacific' as IlasFundCategory, risk_rating: 'Low' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'JPMorgan Asset Management (Europe) S.á r.l.', fund_size: 'US$1529.1' },
  { fund_code: 'F07', aia_fund_code: 'F07', name_en: 'JPM Japan Equity J (dist) USD', category: 'equity_asia_pacific' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'JPMorgan Asset Management (Europe) S.á r.l.', fund_size: 'US$4082.8' },
  { fund_code: 'F08', aia_fund_code: 'F08', name_en: 'JPMorgan ASEAN Fund - USD Class (acc)', category: 'equity_asia_pacific' as IlasFundCategory, risk_rating: 'Medium' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'JPMorgan Funds (Asia) Ltd.', fund_size: 'US$1198.5' },
  { fund_code: 'F10', aia_fund_code: 'F10', name_en: 'JPMorgan Asia Growth Fund', category: 'equity_asia_pacific' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'JPMorgan Funds (Asia) Ltd.', fund_size: 'US$631.3' },
  { fund_code: 'F02', aia_fund_code: 'F02', name_en: 'JPMorgan Asian Smaller Companies Fund', category: 'equity_asia_pacific' as IlasFundCategory, risk_rating: 'Medium' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'JPMorgan Funds (Asia) Ltd.', fund_size: 'US$182.0' },
  { fund_code: 'F15', aia_fund_code: 'F15', name_en: 'JPMorgan China Equity High Income (acc) - USD', category: 'equity_china_hk' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'JPMorgan Funds (Asia) Ltd.', fund_size: 'US$270.7' },
  { fund_code: 'Z24', aia_fund_code: 'Z24', name_en: 'JPMorgan China Equity High Income (mth) - RMB (hedged) class (Dis)', category: 'equity_china_hk' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'RMB', is_distribution: true, fund_house: 'JPMorgan Funds (Asia) Ltd.', fund_size: 'US$270.7' },
  { fund_code: 'Z04', aia_fund_code: 'Z04', name_en: 'JPMorgan China Equity High Income (mth) - USD class (Dis)', category: 'equity_china_hk' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: true, fund_house: 'JPMorgan Funds (Asia) Ltd.', fund_size: 'US$270.7' },
  { fund_code: 'F11', aia_fund_code: 'F11', name_en: 'JPMorgan Europe Dynamic Fund "A (acc) - USD (hedged)"', category: 'equity_europe' as IlasFundCategory, risk_rating: 'Medium' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'JPMorgan Asset Management (Europe) S.á r.l.', fund_size: 'US$1561.5' },
  { fund_code: 'F12', aia_fund_code: 'F12', name_en: 'JPMorgan Funds - Europe Dynamic Technologies Fund "A (acc) - USD (hedged)"', category: 'equity_sector' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'JPMorgan Asset Management (Europe) S.á r.l.', fund_size: 'US$448.4' },
  { fund_code: 'F16', aia_fund_code: 'F16', name_en: 'JPMorgan Funds - Income Fund A (acc) USD Share Class', category: 'fixed_income_global' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'JPMorgan Asset Management (Europe) S.á r.l.', fund_size: 'US$13651.6' },
  { fund_code: 'Z32', aia_fund_code: 'Z32', name_en: 'JPMorgan Funds - Income Fund A (mth) - RMB (hedged) (Dis)', category: 'fixed_income_global' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'RMB', is_distribution: true, fund_house: 'JPMorgan Asset Management (Europe) S.á r.l.', fund_size: 'US$13651.6' },
  { fund_code: 'Z12', aia_fund_code: 'Z12', name_en: 'JPMorgan Funds - Income Fund A (mth) USD Share Class (Dis)', category: 'fixed_income_global' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: true, fund_house: 'JPMorgan Asset Management (Europe) S.á r.l.', fund_size: 'US$13651.6' },
  { fund_code: 'F09', aia_fund_code: 'F09', name_en: 'JPMorgan India Fund', category: 'equity_asia_pacific' as IlasFundCategory, risk_rating: 'Medium' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'JPMorgan Funds (Asia) Ltd.', fund_size: 'US$565.4' },
  { fund_code: 'F03', aia_fund_code: 'F03', name_en: 'JPMorgan Korea Fund', category: 'equity_asia_pacific' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'JPMorgan Funds (Asia) Ltd.', fund_size: 'US$347.9' },
  { fund_code: 'F13', aia_fund_code: 'F13', name_en: 'JPMorgan Latin America Equity Fund "A (acc) - USD"', category: 'equity_emerging_markets' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'JPMorgan Asset Management (Europe) S.á r.l.', fund_size: 'US$550.5' },
  { fund_code: 'F06', aia_fund_code: 'F06', name_en: 'JPMorgan Pacific Securities Fund', category: 'equity_asia_pacific' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'JPMorgan Funds (Asia) Ltd.', fund_size: 'US$744.4' },
  { fund_code: 'F05', aia_fund_code: 'F05', name_en: 'JPMorgan Pacific Technology Fund', category: 'equity_sector' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'JPMorgan Funds (Asia) Ltd.', fund_size: 'US$970.4' },
  { fund_code: 'N08', aia_fund_code: 'N08', name_en: 'Morgan Stanley Investment Funds Global Bond Fund Class A', category: 'fixed_income_global' as IlasFundCategory, risk_rating: 'Low' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'MSIM Fund Management (Ireland) Limited', fund_size: 'US$1085.9' },
  { fund_code: 'N01', aia_fund_code: 'N01', name_en: 'Morgan Stanley Investment Funds Global Convertible Bond Fund "A"', category: 'fixed_income_global' as IlasFundCategory, risk_rating: 'Low' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'MSIM Fund Management (Ireland) Limited', fund_size: 'US$808.7' },
  { fund_code: 'N07', aia_fund_code: 'N07', name_en: 'Morgan Stanley Investment Funds Global Opportunity Fund Class A', category: 'equity_global' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'MSIM Fund Management (Ireland) Limited', fund_size: 'US$12920.4' },
  { fund_code: 'N06', aia_fund_code: 'N06', name_en: 'Morgan Stanley Investment Funds US Advantage Fund "A"', category: 'equity_us' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'MSIM Fund Management (Ireland) Limited', fund_size: 'US$3342.5' },
  { fund_code: 'Z05', aia_fund_code: 'Z05', name_en: 'Neuberger Berman Investment Funds plc - Neuberger Berman Emerging Market Debt - Hard Currency Fund USD A (Monthly) Distributing Class (Dis)', category: 'fixed_income_emerging_markets' as IlasFundCategory, risk_rating: 'Medium' as IlasRiskLevel, currency: 'USD', is_distribution: true, fund_house: 'Neuberger Berman Asset Management Ireland Limited', fund_size: 'US$3694.7' },
  { fund_code: 'NB1', aia_fund_code: 'NB1', name_en: 'Neuberger Berman Investment Funds plc - Neuberger Berman Emerging Market Debt - Hard Currency Fund USD A-Acc', category: 'fixed_income_emerging_markets' as IlasFundCategory, risk_rating: 'Medium' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'Neuberger Berman Asset Management Ireland Limited', fund_size: 'US$3694.7' },
  { fund_code: 'Y22', aia_fund_code: 'Y22', name_en: 'Ninety One Global Strategy Fund - All China Bond Fund A Acc Share Class RMB', category: 'fixed_income_china_hk' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'RMB', is_distribution: false, fund_house: 'Ninety One Luxembourg S.A.', fund_size: 'US$46.3' },
  { fund_code: 'Y02', aia_fund_code: 'Y02', name_en: 'Ninety One Global Strategy Fund - All China Bond Fund A Acc Share Class USD', category: 'fixed_income_china_hk' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'Ninety One Luxembourg S.A.', fund_size: 'US$46.3' },
  { fund_code: 'Z11', aia_fund_code: 'Z11', name_en: 'Ninety One Global Strategy Fund - All China Bond Fund A Inc-3 Share Class (Dis)', category: 'fixed_income_china_hk' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: true, fund_house: 'Ninety One Luxembourg S.A.', fund_size: 'US$46.3' },
  { fund_code: 'Y03', aia_fund_code: 'Y03', name_en: 'Ninety One Global Strategy Fund - European Equity Fund A Acc Share Class', category: 'equity_europe' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'EUR', is_distribution: false, fund_house: 'Ninety One Luxembourg S.A.', fund_size: 'US$936.0' },
  { fund_code: 'Y04', aia_fund_code: 'Y04', name_en: 'Ninety One Global Strategy Fund - Global Environment Fund A Inc Share Class USD', category: 'equity_global' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'Ninety One Luxembourg S.A.', fund_size: 'US$467.3' },
  { fund_code: 'P53', aia_fund_code: 'P53', name_en: 'Pictet - Premium Brands - HR', category: 'equity_sector' as IlasFundCategory, risk_rating: 'Medium' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'Pictet Asset Management (Europe) S.A.', fund_size: 'US$1467.2' },
  { fund_code: 'A19', aia_fund_code: 'A19', name_en: 'PineBridge Global Funds - PineBridge Asia ex Japan Equity Fund "L"', category: 'equity_asia_pacific' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'PineBridge Investments Ireland Limited', fund_size: 'US$78.5' },
  { fund_code: 'A26', aia_fund_code: 'A26', name_en: 'PineBridge Global Funds - PineBridge Asia ex Japan Small Cap Equity Fund "A"', category: 'equity_asia_pacific' as IlasFundCategory, risk_rating: 'Medium' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'PineBridge Investments Ireland Limited', fund_size: 'US$152.9' },
  { fund_code: 'A32', aia_fund_code: 'A32', name_en: 'PineBridge Global Funds - PineBridge Global Dynamic Asset Allocation Fund "AA"', category: 'multi_assets_global' as IlasFundCategory, risk_rating: 'Low' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'PineBridge Investments Ireland Limited', fund_size: 'US$294.9' },
  { fund_code: 'Z06', aia_fund_code: 'Z06', name_en: 'PineBridge Global Funds - PineBridge Global Dynamic Asset Allocation Fund Class ADC Units (Dis)', category: 'multi_assets_global' as IlasFundCategory, risk_rating: 'Low' as IlasRiskLevel, currency: 'USD', is_distribution: true, fund_house: 'PineBridge Investments Ireland Limited', fund_size: 'US$294.9' },
  { fund_code: 'A15', aia_fund_code: 'A15', name_en: 'PineBridge Global Funds - PineBridge Global Focus Equity Fund "L"', category: 'equity_global' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'PineBridge Investments Ireland Limited', fund_size: 'US$2870.9' },
  { fund_code: 'A17', aia_fund_code: 'A17', name_en: 'PineBridge Global Funds - PineBridge Greater China Equity Fund "A"', category: 'equity_asia_pacific' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'PineBridge Investments Ireland Limited', fund_size: 'US$69.5' },
  { fund_code: 'A29', aia_fund_code: 'A29', name_en: 'PineBridge Global Funds - PineBridge India Equity Fund "A"', category: 'equity_asia_pacific' as IlasFundCategory, risk_rating: 'Medium' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'PineBridge Investments Ireland Limited', fund_size: 'US$615.2' },
  { fund_code: 'A30', aia_fund_code: 'A30', name_en: 'PineBridge Global Funds - PineBridge Japan Equity Fund "A"', category: 'equity_asia_pacific' as IlasFundCategory, risk_rating: 'Medium' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'PineBridge Investments Ireland Limited', fund_size: 'US$40.9' },
  { fund_code: 'A21', aia_fund_code: 'A21', name_en: 'PineBridge Global Funds - PineBridge Latin America Equity Fund "Y"', category: 'equity_emerging_markets' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'PineBridge Investments Ireland Limited', fund_size: 'US$76.0' },
  { fund_code: 'A22', aia_fund_code: 'A22', name_en: 'PineBridge Global Funds - PineBridge US Research Enhanced Core Equity Fund "A"', category: 'equity_us' as IlasFundCategory, risk_rating: 'Medium' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'PineBridge Investments Ireland Limited', fund_size: 'US$195.7' },
  { fund_code: 'A05', aia_fund_code: 'A05', name_en: 'PineBridge Hong Kong Dollar Money Market Fund', category: 'liquidity_money_market' as IlasFundCategory, risk_rating: 'Low' as IlasRiskLevel, currency: 'HKD', is_distribution: false, fund_house: 'PineBridge Investments Hong Kong Limited', fund_size: 'US$41.3' },
  { fund_code: 'HEQ', aia_fund_code: 'HEQ', name_en: 'PineBridge Hong Kong Equity Fund', category: 'equity_china_hk' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'HKD', is_distribution: false, fund_house: 'PineBridge Investments Hong Kong Limited', fund_size: 'US$2274.7' },
  { fund_code: 'PC4', aia_fund_code: 'PC4', name_en: 'Principal Global Investors Funds - Preferred Securities Fund USD A Class Acc', category: 'fixed_income_global' as IlasFundCategory, risk_rating: 'Low' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'Principal Global Investors (Ireland) Limited', fund_size: 'US$3831.0' },
  { fund_code: 'ZP4', aia_fund_code: 'ZP4', name_en: 'Principal Global Investors Funds - Preferred Securities Fund USD D2 Class Income Plus Units (Dis)', category: 'fixed_income_global' as IlasFundCategory, risk_rating: 'Low' as IlasRiskLevel, currency: 'USD', is_distribution: true, fund_house: 'Principal Global Investors (Ireland) Limited', fund_size: 'US$3831.0' },
  { fund_code: 'J15', aia_fund_code: 'J15', name_en: 'Schroder International Selection Fund - Asian Opportunities "A1"', category: 'equity_asia_pacific' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'Schroder Investment Management (Europe) S.A.', fund_size: 'US$6783.0' },
  { fund_code: 'Z30', aia_fund_code: 'Z30', name_en: 'Schroder International Selection Fund - Dynamic Income Class A RMB Hedged Dis MF2 (Dis)', category: 'multi_assets_global' as IlasFundCategory, risk_rating: 'Medium' as IlasRiskLevel, currency: 'RMB', is_distribution: true, fund_house: 'Schroder Investment Management (Europe) S.A.', fund_size: 'US$310.1' },
  { fund_code: 'J20', aia_fund_code: 'J20', name_en: 'Schroder International Selection Fund - Dynamic Income Class A USD Acc', category: 'multi_assets_global' as IlasFundCategory, risk_rating: 'Medium' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'Schroder Investment Management (Europe) S.A.', fund_size: 'US$310.1' },
  { fund_code: 'Z20', aia_fund_code: 'Z20', name_en: 'Schroder International Selection Fund - Dynamic Income Class A USD Dis MF2 (Dis)', category: 'multi_assets_global' as IlasFundCategory, risk_rating: 'Medium' as IlasRiskLevel, currency: 'USD', is_distribution: true, fund_house: 'Schroder Investment Management (Europe) S.A.', fund_size: 'US$310.1' },
  { fund_code: 'J07', aia_fund_code: 'J07', name_en: 'Schroder International Selection Fund - Emerging Markets Debt Total Return "A1"', category: 'fixed_income_emerging_markets' as IlasFundCategory, risk_rating: 'Low' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'Schroder Investment Management (Europe) S.A.', fund_size: 'US$1210.5' },
  { fund_code: 'J14', aia_fund_code: 'J14', name_en: 'Schroder International Selection Fund - Global Emerging Market Opportunities "A1"', category: 'equity_emerging_markets' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'Schroder Investment Management (Europe) S.A.', fund_size: 'US$2981.7' },
  { fund_code: 'J16', aia_fund_code: 'J16', name_en: 'Schroder International Selection Fund - Global Equity Yield "A1"', category: 'equity_global' as IlasFundCategory, risk_rating: 'Medium' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'Schroder Investment Management (Europe) S.A.', fund_size: 'US$257.6' },
  { fund_code: 'J03', aia_fund_code: 'J03', name_en: 'Schroder International Selection Fund - Hong Kong Equity "A1"', category: 'equity_china_hk' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'HKD', is_distribution: false, fund_house: 'Schroder Investment Management (Europe) S.A.', fund_size: 'US$907.3' },
  { fund_code: 'J08', aia_fund_code: 'J08', name_en: 'Schroder International Selection Fund - Taiwanese Equity "A1"', category: 'equity_asia_pacific' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'Schroder Investment Management (Europe) S.A.', fund_size: 'US$221.1' },
  { fund_code: 'U05', aia_fund_code: 'U05', name_en: 'UBS (Lux) Equity Fund - China Opportunity (USD) P-acc', category: 'equity_china_hk' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'UBS Asset Management (Europe) S.A.', fund_size: 'US$3442.9' },
  { fund_code: 'V03', aia_fund_code: 'V03', name_en: 'Value Partners Chinese Mainland Focus Fund', category: 'equity_china_hk' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'Value Partners Limited', fund_size: 'US$162.4' },
  { fund_code: 'V04', aia_fund_code: 'V04', name_en: 'Value Partners Classic Fund "C"', category: 'equity_asia_pacific' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'Value Partners Hong Kong Limited', fund_size: 'US$1121.3' },
  { fund_code: 'V02', aia_fund_code: 'V02', name_en: 'Value Partners High Dividend Stocks Fund "A1"', category: 'equity_asia_pacific' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'Value Partners Hong Kong Limited', fund_size: 'US$1803.9' },
  { fund_code: 'Z01', aia_fund_code: 'Z01', name_en: 'Value Partners High Dividend Stocks Fund Class A2 MDis (Dis)', category: 'equity_asia_pacific' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: true, fund_house: 'Value Partners Hong Kong Limited', fund_size: 'US$1803.9' },
  { fund_code: 'Z21', aia_fund_code: 'Z21', name_en: 'Value Partners High Dividend Stocks Fund Class A2 RMB H MDis (Dis)', category: 'equity_asia_pacific' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'RMB', is_distribution: true, fund_house: 'Value Partners Hong Kong Limited', fund_size: 'US$1803.9' },
  { fund_code: 'V07', aia_fund_code: 'V07', name_en: 'Value Partners Multi-Asset Fund "A Acc"', category: 'multi_assets_global' as IlasFundCategory, risk_rating: 'High' as IlasRiskLevel, currency: 'USD', is_distribution: false, fund_house: 'Value Partners Hong Kong Limited', fund_size: 'US$38.2' },
] as const;

// ===== Derived Lookups =====

// Fund code → display name
export const ILAS_FUND_CODE_TO_NAME: Record<string, string> = Object.fromEntries(
  AIA_ILAS_FUNDS.map(f => [f.fund_code, f.name_en])
);

/** Convert fund allocation array to human-readable string */
export function formatIlasAllocation(alloc: FundAllocation[]): string {
  return alloc
    .filter(a => a.weight > 0)
    .map(a => `${ILAS_FUND_CODE_TO_NAME[a.code] || a.code} ${a.weight}%`)
    .join(' / ');
}

// ===== Screener Category Groupings =====

export const ILAS_SCREENER_CATEGORIES = {
  All: null,
  Equity: [
    'equity_asia_pacific',
    'equity_china_hk',
    'equity_emerging_markets',
    'equity_europe',
    'equity_global',
    'equity_sector',
    'equity_us',
  ] as IlasFundCategory[],
  'Fixed Income': [
    'fixed_income_asia_pacific',
    'fixed_income_china_hk',
    'fixed_income_emerging_markets',
    'fixed_income_global',
    'fixed_income_us',
  ] as IlasFundCategory[],
  'Multi-Assets': [
    'multi_assets_asia_pacific',
    'multi_assets_global',
    'multi_assets_us',
  ] as IlasFundCategory[],
  'Money Market': [
    'liquidity_money_market',
  ] as IlasFundCategory[],
} as const;

// ===== Constants =====

// Risk-free rate for Sharpe/Sortino (HIBOR approximate, annual)
export const ILAS_RISK_FREE_RATE = 0.04;

// Portfolio synthetic fund base NAV
export const ILAS_PORTFOLIO_BASE_NAV = 100;

// Insight disclaimer text (bilingual)
export const ILAS_INSIGHT_DISCLAIMER = {
  en: 'Internal reference material for AIA team discussion. Not financial advice. Generated by AIA ILAS Track.',
  zh: '此為AIA團隊內部討論參考資料，並非投資建議。由AIA投連險追蹤系統生成。',
};

// ===== Rebalancer: Defensive Funds =====
// Funds with risk_rating = 'Low' OR category containing 'Fixed Income' / 'Liquidity'
// Split by portfolio type (accumulation vs distribution)

export const ILAS_DEFENSIVE_FUNDS: Record<string, string[]> = {
  accumulation: [
    'A05', 'A32', 'B01', 'C03', 'C09', 'CG9', 'E05', 'F14', 'F16',
    'G16', 'I17', 'I27', 'I28', 'J07', 'L51', 'M10', 'M11', 'M13',
    'N01', 'N08', 'NB1', 'P05', 'P08', 'PC4', 'Q02', 'R03', 'R52',
    'W04', 'W06', 'X15', 'Y02', 'Y22',
  ],
  distribution: [
    'Z03', 'Z05', 'Z06', 'Z08', 'Z11', 'Z12', 'Z13', 'Z15', 'Z16',
    'Z17', 'Z25', 'Z26', 'Z29', 'Z32', 'Z33', 'Z36', 'Z39', 'Z52',
    'Z66', 'Z69', 'ZL1', 'ZP4',
  ],
};

// ===== Rebalancer: Investment Profile =====

export const ILAS_INVESTMENT_PROFILE = {
  label: 'Balanced Growth (ILAS)',
  description: 'Long-term wealth accumulation via insurance-linked funds',
};

// ===== Rebalancer: Config =====

export const ILAS_REBALANCER_CONFIG = {
  DAILY_CAP: 3,
  WEEKLY_LIMIT_DAYS: 7,
  PRICE_FRESHNESS_DAYS: 7,
  METRICS_COVERAGE_PCT: 0.8,
  DANGER_SORTINO_THRESHOLD: 0,
  DANGER_DRAWDOWN_THRESHOLD: -20,
  DANGER_MOMENTUM_THRESHOLD: -5,
  EQUITY_CEILING_ON_DANGER: 40,
  NUM_FUNDS_IN_PORTFOLIO: 3,
  WEIGHT_INCREMENT: 10,
};

// ===== Fund Houses =====
// All 29 fund houses across the 142 ILAS funds

export const ILAS_FUND_HOUSE_LIST: string[] = [
  'AllianceBernstein (Luxembourg) S.a.r.l.',
  'Allianz Global Investors GmbH',
  'Amundi Luxembourg S.A.',
  'BNP Paribas Asset Management Luxembourg',
  'Baring International Fund Managers (Ireland) Limited',
  'BlackRock (Luxembourg) S.A.',
  'Capital International Management Company',
  'FIL Investment Management (Luxembourg) S.A.',
  'First Sentier Investors (Ireland) Limited',
  'Franklin Templeton International Services S.á r.l.',
  'FundRock Management Company S.A.',
  'HSBC Investment Funds (Hong Kong) Limited',
  'HSBC Investment Funds (Luxembourg) S.A.',
  'Invesco Management S.A.',
  'JPMorgan Asset Management (Europe) S.á r.l.',
  'JPMorgan Funds (Asia) Ltd.',
  'Janus Henderson Investors Europe S.A.',
  'MSIM Fund Management (Ireland) Limited',
  'Neuberger Berman Asset Management Ireland Limited',
  'Ninety One Luxembourg S.A.',
  'Pictet Asset Management (Europe) S.A.',
  'PineBridge Investments Hong Kong Limited',
  'PineBridge Investments Ireland Limited',
  'Principal Global Investors (Ireland) Limited',
  'Schroder Investment Management (Europe) S.A.',
  'UBS Asset Management (Europe) S.A.',
  'Value Partners Hong Kong Limited',
  'Value Partners Limited',
  'abrdn Investments Luxembourg S.A.',
];
