#!/bin/bash
# AIA Knowledge Assistant — Batch Document Ingest
# Runs weekly (Sunday 02:00) via launchd
# Checks docs/pdfs-to-upload/ for new PDFs, uploads to app, moves to docs/pdfs-uploaded/

set -euo pipefail

PROJECT_DIR="/Users/kingyuenjonathanlee/Documents/ClaudeWorkSpace/02_Product/aia-assistant"
UPLOAD_DIR="$PROJECT_DIR/docs/pdfs-to-upload"
LOG_FILE="/tmp/aia-batch-ingest.log"
APP_URL="${AIA_APP_URL:-https://aia-assistant.vercel.app}"
SECRET="${BATCH_INGEST_SECRET:-}"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Batch ingest starting" >> "$LOG_FILE"

# Check for secret
if [ -z "$SECRET" ]; then
  if [ -f "$PROJECT_DIR/.env.local" ]; then
    SECRET=$(grep -E "^(CRON_SECRET|BATCH_INGEST_SECRET)=" "$PROJECT_DIR/.env.local" | head -1 | cut -d= -f2-)
  fi
fi

if [ -z "$SECRET" ]; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] ERROR: No BATCH_INGEST_SECRET or CRON_SECRET found" >> "$LOG_FILE"
  exit 1
fi

# Count PDFs
PDF_COUNT=$(find "$UPLOAD_DIR" -maxdepth 1 -name "*.pdf" -type f 2>/dev/null | wc -l | tr -d ' ')

if [ "$PDF_COUNT" -eq 0 ]; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] No PDFs in upload folder. Done." >> "$LOG_FILE"
  exit 0
fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Found $PDF_COUNT PDF(s) to ingest" >> "$LOG_FILE"

# Call the batch-ingest API — it reads from docs/pdfs-to-upload/ and moves to docs/pdfs-uploaded/
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$APP_URL/api/batch-ingest" \
  -H "Authorization: Bearer $SECRET" \
  -H "Content-Type: application/json" \
  --max-time 300)

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$HTTP_CODE" -eq 200 ]; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] SUCCESS: $BODY" >> "$LOG_FILE"
else
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] ERROR ($HTTP_CODE): $BODY" >> "$LOG_FILE"
  exit 1
fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Batch ingest complete" >> "$LOG_FILE"
