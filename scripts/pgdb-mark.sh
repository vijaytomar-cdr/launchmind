#!/usr/bin/env bash
# Stamps a local disposable database with its generation — P1-45.
#
#   npm run pgdb:mark      → marks the isolated PG database  PG_INTEGRATION
#   npm run staging:mark   → marks the browser database      BROWSER_CERT
#
# Applied ONCE per database, deliberately outside the migration set: migrations
# replay on both, so a migration-created marker would claim the same generation
# in both places and answer nothing.
set -euo pipefail
GENERATION="${1:?generation required (PG_INTEGRATION | BROWSER_CERT)}"
WORKDIR="${2:-.}"

case "$GENERATION" in PG_INTEGRATION|BROWSER_CERT) ;; *)
  echo "REFUSED: unknown generation '$GENERATION'"; exit 3;; esac

PROJECT_ID=$(grep -m1 '^project_id' "$WORKDIR/supabase/config.toml" | sed 's/.*= *"\(.*\)"/\1/')
DBC=$(docker ps --format '{{.Names}}' | grep -E "supabase_db_${PROJECT_ID}\$" | head -1)
[ -z "$DBC" ] && { echo "REFUSED: no running database for project '$PROJECT_ID'"; exit 3; }

echo "marking $DBC as $GENERATION"
docker exec -i -e PGPASSWORD=postgres "$DBC" \
  psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 \
  -v generation="$GENERATION" -f - < scripts/db-generation-marker.sql
echo "marked."
