---
project: AIA Knowledge Assistant
status: active
updated: 2026-04-02
---

# AIA Knowledge Assistant

## Goal
AI-powered knowledge system for insurance agents to instantly answer policy, product, and pricing questions.

## Target Audience
Insurance agents at AIA Hong Kong and partner agencies.

## Voice & Tone
Professional, direct, knowledgeable — the tone of a trusted colleague answering instantly.

## Tech Stack
Next.js 16, React 19, Supabase (auth + RLS), Claude API via @ai-sdk/gateway, Tesseract.js (OCR), ExcelJS, PDF-parse, Recharts, Tailwind 4, Playwright e2e.

## Skills Used
- [[deploy-aia]] — CI/CD runbook
- [[verify-aia]] — end-to-end product verification
- [[app-audit]] — full-stack audit
- [[pre-ship-gate]] — pre-commit checks
- [[mpf-client-review]] — client meeting prep
- [[mpf-fund-comps]] — fund comparison
- [[mpf-rebalance]] — allocation drift analysis

## Key Decisions
- Chat + RAG architecture for document ingestion (policies, price sheets, FAQs).
- Document upload with OCR fallback (handles PDFs, images, Excel).
- Multi-tenant ready — foundation for [[1m-hkd-roadmap]] white-label platform.
- Pipeline bootstrap strategy: synthetic backfill to start metric calculations early.

## Current Phase
ILAS integrations (price API + historical backfill), MPF Care calculation module, security hardening before external agency rollout.

## Related Projects
- [[1m-hkd-roadmap]] — commercialized version of this product
- [[mission-control]] — admin panel for managing deployments
- [[training-program]] — agent training uses this product
