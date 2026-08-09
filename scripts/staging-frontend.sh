#!/usr/bin/env bash
# Runs the Next.js frontend against the STAGING stack.
#
# Two things this handles that a bare `next dev` does not:
#   1. PORT=3001 in .env.staging is for the BACKEND. Next would otherwise take it
#      and collide, so PORT is unset and the port passed explicitly.
#   2. Next auto-loads .env.local (which points at PRODUCTION Supabase). Real
#      environment variables take precedence over .env files, so exporting the
#      staging values first is what keeps the browser bundle on staging.
set -a
. "$(dirname "$0")/../.env.staging"
set +a
unset PORT
exec npx next dev -p 3000
