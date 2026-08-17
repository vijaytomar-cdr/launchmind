#!/usr/bin/env bash
# Applies backend/migrations (the authoritative set) to the local staging Postgres.
#
# supabase/migrations is NOT used: it is stale (61 vs 87 files) and contains the
# ClientPulse demo seed, which staging must not have (Step 9B §4). Those two seed
# migrations are skipped deliberately.
#
# "already exists" is reported separately from a real error. Ten migrations are not
# idempotent (CREATE INDEX / CREATE POLICY without IF NOT EXISTS), which violates
# CLAUDE.md §1.2 — that is a real defect, but it must not make a correct re-run of
# this script look like a broken environment.
set -uo pipefail
DBC=$(docker ps --format '{{.Names}}' | grep -E 'supabase_db' | head -1)
[ -z "$DBC" ] && { echo "staging Supabase is not running — run: npm run staging:up"; exit 1; }

applied=0; already=0; skipped=0; fail=0; failed=''
for f in backend/migrations/*.sql; do
  base=$(basename "$f")
  case "$base" in *seed_clientpulse*) skipped=$((skipped+1)); continue;; esac

  # Use Supabase's migration owner. Its default privileges keep PostgREST's
  # service_role usable across local image versions; raw postgres-owned objects
  # do not receive those defaults on newer images.
  out=$(docker exec -i "$DBC" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q < "$f" 2>&1)
  if [ $? -eq 0 ]; then
    applied=$((applied+1))
  elif echo "$out" | grep -qiE "already exists|duplicate object|duplicate_object"; then
    already=$((already+1))
  else
    fail=$((fail+1)); failed="$failed $base"
    echo "  ERROR in $base:"; echo "$out" | grep -iE '^ERROR' | head -1 | sed 's/^/    /'
  fi
done

echo "  applied: $applied   already present: $already   skipped (demo seed): $skipped   failed: $fail"
[ "$fail" -gt 0 ] && exit 1
exit 0
