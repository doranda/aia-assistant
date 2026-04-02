---
id: pipeline-bootstrap-strategy
domain: data-pipelines
confidence: 0.3
created: 2026-04-02
confirmed: 0
---

# Multi-Stage Pipeline Bootstrap: Break the Chicken-and-Egg

When stage N requires stage N-1 to have accumulated data over time, the pipeline never starts without a bootstrap strategy.

**ILAS example:** Weekly debate needs metrics → metrics need 20 price points → only 3 days of prices.
**Solution:** Three-layer bootstrap:
1. Backfill endpoint to generate synthetic historical data
2. Bootstrap mode in compute layer (simplified calcs for 3-19 data points)
3. Relaxed gate thresholds that tighten as data accumulates

**When to apply:** Any pipeline where a downstream consumer requires a minimum data window (e.g., rolling averages, Sharpe ratios, moving windows).
