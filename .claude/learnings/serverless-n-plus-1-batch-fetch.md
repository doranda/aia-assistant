---
id: serverless-n-plus-1-batch-fetch
domain: backend-performance
confidence: 0.5
created: 2026-04-02
confirmed: 1
---

# Serverless N+1: Batch Fetch or Die

N+1 query patterns that work locally (fast DB, no network hop) silently timeout in serverless functions. The ILAS metrics cron made 142 individual Supabase queries — worked fine in dev, timed out at 60s in production.

**Fix:** One batch query + in-memory Map grouping. Went from timeout to 3.4 seconds.

**When to check:** Any time you loop over entities and query DB inside the loop. If the entity count can grow beyond ~20, batch-fetch first.

**Pattern:**
```typescript
// BAD: N+1
for (const fund of funds) {
  const { data } = await supabase.from("prices").select("*").eq("fund_id", fund.id);
}

// GOOD: Batch + Map
const { data: allPrices } = await supabase.from("prices").select("*");
const pricesByFund = new Map();
for (const p of allPrices) {
  if (!pricesByFund.has(p.fund_id)) pricesByFund.set(p.fund_id, []);
  pricesByFund.get(p.fund_id).push(p);
}
```
