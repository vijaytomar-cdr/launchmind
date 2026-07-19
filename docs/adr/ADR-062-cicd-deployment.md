# ADR-062 — CI/CD & Deployment Pipeline

**Status:** Accepted  
**Date:** 2026-07-10  
**Milestone:** M12 — Production Hardening

---

## Context

LaunchMind uses a dual-host deployment model: Vercel for the Next.js frontend and Oracle Cloud VM for the Fastify backend. The CI/CD pipeline must enforce quality gates before any promotion to staging or production.

---

## Decision

### 1. Branch Strategy

```
main       ← production (Vercel auto-deploy + Oracle VM via CD)
staging    ← DAST target, phase gate
dev        ← integration branch
feature/*  ← branch from dev
security/* ← expedited, 1-reviewer merge to main
```

### 2. CI Pipeline (`.github/workflows/ci.yml`)

**Triggers:** Push to `dev`, `staging`, `main`; PR to any of those branches.

**Stages (sequential):**
1. **Dependency install** — `npm ci` (locked lockfile)
2. **TypeScript compile** — `npx tsc --noEmit` — fail on any error
3. **SAST** — `semgrep --config=p/nodejs-security .` + `eslint --plugin security .` — fail on HIGH+
4. **Dependency scan** — `npm audit --audit-level=high` + `npx snyk test --severity-threshold=high` — fail on HIGH+ CVE
5. **Unit tests** — `npm test` (Vitest) — fail on any test failure
6. **Coverage gate** — coverage ≥ 80% lines for new code — fail if below
7. **Secret scan** — `git grep -rE "(key|secret|password|token)\s*=\s*['\"][^'\"]{8,}"` — fail on any match
8. **Build** — `npm run build` (Next.js) — fail on any error

**PR requirements:** All 8 stages must pass. No bypass (`--no-verify` blocked).

### 3. CD Pipeline (`.github/workflows/deploy.yml`)

**Triggers:** Push to `main` (after CI passes).

**Frontend (Vercel):**
- Auto-deploy via Vercel GitHub integration
- Preview deployments on every PR to `main`
- Production deployment on merge to `main`
- Rollback: Vercel dashboard `Deployments` → `Redeploy` any previous successful deployment

**Backend (Oracle VM):**
```bash
# oracle-deploy.sh
docker build -t launchmind-backend:${GIT_SHA} .
docker push registry.oracle.com/launchmind/backend:${GIT_SHA}
ssh oracle-vm "
  docker pull registry.oracle.com/launchmind/backend:${GIT_SHA}
  docker stop launchmind-backend || true
  docker run -d --name launchmind-backend \
    --env-file /opt/launchmind/.env \
    -p 3001:3001 \
    registry.oracle.com/launchmind/backend:${GIT_SHA}
"
```

**Migration gate:** Migrations run before container switch:
```bash
# Run all pending migrations against hosted Supabase
npx supabase db push --project-ref gseqtbwdenjkwysregpp
```

**Zero-downtime:** Nginx upstream health check (`/health`) — traffic shifted to new container only when `/health` returns 200. Old container stops after 30s drain.

### 4. Rollback Strategy

**Frontend:** Vercel instant rollback via dashboard. Target: < 2 min to previous deployment.

**Backend:**
```bash
# Emergency rollback to previous SHA
docker stop launchmind-backend
docker run -d --name launchmind-backend \
  --env-file /opt/launchmind/.env \
  -p 3001:3001 \
  registry.oracle.com/launchmind/backend:${PREV_SHA}
```

**Database:** Migrations are additive-only (CLAUDE.md §1.2). No migration is ever rolled back — if a column causes issues, a new migration adds the fix. Rollback = re-deploy previous container (schema is additive-compatible).

**Feature flags:** Not yet implemented. Deferred to M13. Current approach: hotfix branch → CI pipeline → deploy within 30 min.

### 5. Environment Promotion

| Stage | Trigger | Gate |
|---|---|---|
| dev | Push to dev | CI (SAST, tests, build) |
| staging | Merge to staging | CI + OWASP ZAP DAST |
| production | Merge to main | CI + DAST + manual approval (1 reviewer) |

**DAST on staging:** OWASP ZAP Docker:
```bash
docker run -t owasp/zap2docker-stable zap-baseline.py \
  -t https://staging.launchmind.com \
  -J zap-report.json \
  --fail-threshold HIGH
```

Block promotion on HIGH or CRITICAL findings.

### 6. Backup & Disaster Recovery

**Supabase Postgres:**
- Daily snapshots via Supabase managed backups (retained 7 days on Pro plan)
- Point-in-time recovery (PITR) via Supabase (retained 7 days)
- Weekly manual export: `pg_dump` → encrypted S3 bucket → retained 90 days

**Oracle VM:**
- Docker image: tagged and pushed to Oracle Container Registry on every deploy
- `/opt/launchmind/.env`: encrypted backup in AWS Secrets Manager
- Previous 5 image tags retained for fast rollback

**Recovery Time Objectives:**
- Frontend: 2 min (Vercel rollback)
- Backend: 10 min (Docker pull + start)
- Database: 30 min (Supabase PITR restore)
- Full DR (new VM): 2 hours (Oracle VM provisioning + setup)

---

## Consequences

**Positive:**
- 8-stage CI gate catches security issues before they reach production.
- Zero-downtime deployment via Nginx health check drain.
- Additive-only migrations eliminate rollback complexity.

**Risks:**
- Manual approval gate for production adds 15–30 min to deployment cadence — acceptable for current team size.
- Oracle VM is a single point of failure (no auto-scaling) — acceptable for current ARR level. Migrate to Kubernetes when MRR > $10K.

---

## References
- CLAUDE.md §5.4 (Branch Strategy)
- `.github/workflows/ci.yml`
- `.github/workflows/deploy.yml`
- `backend/oracle-deploy.sh`
- `docs/oracle-setup.md`
