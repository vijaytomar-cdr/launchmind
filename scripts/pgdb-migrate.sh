#!/usr/bin/env bash
# Replays the authoritative backend migrations onto the ISOLATED PG database.
#
# Mirrors staging-migrate.sh, but targets the .pgcert project and applies NO
# seed of any kind — the PG generation must never carry the browser fixture.
set -uo pipefail
WORKDIR="${PG_CERT_WORKDIR:-.pgcert}"
PROJECT_ID=$(grep -m1 '^project_id' "$WORKDIR/supabase/config.toml" | sed 's/.*= *"\(.*\)"/\1/')
DBC=$(docker ps --format '{{.Names}}' | grep -E "supabase_db_${PROJECT_ID}\$" | head -1)
[ -z "$DBC" ] && { echo "isolated PG stack is not running — run: npm run pgdb:up"; exit 1; }

applied=0; already=0; skipped=0; fail=0; failed=''; first=''; last=''; total=0
for f in backend/migrations/*.sql; do
  base=$(basename "$f"); total=$((total+1))
  [ -z "$first" ] && first="$base"; last="$base"
  case "$base" in *seed_clientpulse*) skipped=$((skipped+1)); continue;; esac
  out=$(docker exec -i "$DBC" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q < "$f" 2>&1)
  if [ $? -eq 0 ]; then applied=$((applied+1))
  elif echo "$out" | grep -qiE "already exists|duplicate object|duplicate_object"; then already=$((already+1))
  else fail=$((fail+1)); failed="$failed $base"
    echo "  ERROR in $base:"; echo "$out" | grep -iE '^ERROR' | head -1 | sed 's/^/    /'
  fi
done
echo "  manifest: $total   applied: $applied   already present: $already   skipped (demo seed): $skipped   failed: $fail"
echo "  first: $first   last: $last"
[ "$fail" -gt 0 ] && { echo "  failed:$failed"; exit 1; }
exit 0
