# LaunchMind — Production Deployment Guide

**Date:** 2026-07-10  
**Milestone:** M12 — Production Hardening

---

## 1. Architecture Overview

```
Internet → Cloudflare WAF → Oracle Cloud VM (Nginx) → Fastify Backend (Docker)
                                                     → Supabase Postgres
Internet → Cloudflare → Vercel → Next.js 14 Frontend
Fastify → Upstash Redis (BullMQ + cache)
Fastify → Supabase Storage (marketing images)
Fastify → Claude API (Anthropic)
Fastify → AWS KMS (token vault)
Fastify → Stripe + Razorpay (payments)
Fastify → Resend (email)
```

---

## 2. Pre-Deployment Checklist

Run this checklist before every production deployment:

### 2.1 Code
- [ ] All CI pipeline stages pass (TypeScript, SAST, dependency scan, tests, build)
- [ ] PR approved by ≥ 1 reviewer
- [ ] No secrets in diff (`git grep -rE "(key|secret)..."`)
- [ ] CLAUDE.md §11 updated (if milestone-level change)
- [ ] Database migrations are additive-only

### 2.2 Infrastructure (First Time)
- [ ] Oracle VM running (Oracle Cloud A1 Flex, 4 OCPU, 24GB RAM)
- [ ] Docker + Nginx installed
- [ ] `/opt/launchmind/.env` created with all 35+ env vars
- [ ] SSL certificate installed via Certbot (or Cloudflare Flexible SSL)
- [ ] `pgBouncer` enabled in Supabase dashboard
- [ ] Supabase Storage `content-assets` bucket created (private)
- [ ] AWS KMS CMK created, ARN in `.env`
- [ ] Upstash Redis instance created, URL in `.env`
- [ ] Sentry project created, DSN in `.env`
- [ ] Axiom dataset created, API key in `.env`

### 2.3 Database
- [ ] All pending migrations pushed to hosted Supabase (`supabase db push`)
- [ ] RLS policies verified on all tables (run `psql` check)
- [ ] `playbook_signals` seeded (52 rows from migrations 011 + 018)
- [ ] Seed product data present (vijay@lm.com, ClientPulse)
- [ ] `pgBouncer` connection pooler enabled in Supabase Project Settings

---

## 3. Environment Variables (Complete List)

Required in `/opt/launchmind/.env` (Oracle VM) and Vercel dashboard:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://gseqtbwdenjkwysregpp.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_JWT_SECRET=...

# Backend
NODE_ENV=production
PORT=3001
FRONTEND_URL=https://launchmind.com

# AI
ANTHROPIC_API_KEY=sk-ant-...
REPLICATE_API_TOKEN=r8_...
ELEVENLABS_API_KEY=...
CREATOMATE_API_KEY=...

# Payments
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
RAZORPAY_KEY_ID=rzp_live_...
RAZORPAY_KEY_SECRET=...

# Email
RESEND_API_KEY=re_...
FROM_EMAIL=noreply@launchmind.com

# Security
AWS_KMS_KEY_ID=arn:aws:kms:us-east-1:...
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1

# Cache / Queue
UPSTASH_REDIS_REST_URL=https://...upstash.io
UPSTASH_REDIS_REST_TOKEN=...

# Observability
SENTRY_DSN=https://...@sentry.io/...
AXIOM_API_KEY=xait-...

# Search (optional — enables web competitor discovery)
GOOGLE_CUSTOM_SEARCH_API_KEY=AIza...
GOOGLE_CUSTOM_SEARCH_ENGINE_ID=...

# Stability AI (optional — alternative image generation)
STABILITY_AI_KEY=sk-...
```

**Vercel-only (frontend):**
```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_BACKEND_URL=https://api.launchmind.com
NEXT_PUBLIC_SENTRY_DSN=
NEXT_PUBLIC_POSTHOG_KEY=
NEXT_PUBLIC_POSTHOG_HOST=https://app.posthog.com
```

---

## 4. Deployment Steps

### 4.1 Backend Deployment (Oracle VM)

```bash
# On local machine (or CI/CD runner with SSH access to Oracle VM)

# 1. Build and tag Docker image
docker build -t launchmind-backend:${GIT_SHA} -f backend/Dockerfile backend/

# 2. Push to Oracle Container Registry (or Docker Hub)
docker tag launchmind-backend:${GIT_SHA} ${REGISTRY}/launchmind/backend:${GIT_SHA}
docker push ${REGISTRY}/launchmind/backend:${GIT_SHA}

# 3. Run database migrations
cd backend && npx supabase db push --project-ref gseqtbwdenjkwysregpp

# 4. Deploy to Oracle VM
ssh oracle-vm << 'EOF'
  docker pull ${REGISTRY}/launchmind/backend:${GIT_SHA}
  docker stop launchmind-backend || true
  docker rm launchmind-backend || true
  docker run -d \
    --name launchmind-backend \
    --restart unless-stopped \
    --env-file /opt/launchmind/.env \
    -p 3001:3001 \
    --memory 8g \
    --cpus 3 \
    ${REGISTRY}/launchmind/backend:${GIT_SHA}
  docker image prune -f --filter "label=app=launchmind-backend" --filter "until=48h"
EOF

# 5. Health check (wait for container to be ready)
sleep 5
curl -f https://api.launchmind.com/health || echo "HEALTH CHECK FAILED"
```

### 4.2 Frontend Deployment (Vercel)

```bash
# Auto-deployed by Vercel GitHub integration on push to main
# Manual trigger if needed:
npx vercel --prod
```

### 4.3 Scraper Deployment (separate container)

```bash
docker build -t launchmind-scraper:${GIT_SHA} -f backend/Dockerfile.scraper backend/
# Deploy alongside backend — Playwright requires Chromium in container
docker run -d \
  --name launchmind-scraper \
  --restart unless-stopped \
  --env-file /opt/launchmind/.env \
  --memory 4g \
  --cpus 1 \
  launchmind-scraper:${GIT_SHA}
```

---

## 5. Nginx Configuration

`nginx.conf` on Oracle VM:

```nginx
upstream backend {
  server 127.0.0.1:3001;
  keepalive 16;
}

server {
  listen 443 ssl http2;
  server_name api.launchmind.com;

  ssl_certificate /etc/letsencrypt/live/api.launchmind.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/api.launchmind.com/privkey.pem;
  ssl_protocols TLSv1.3;

  location / {
    proxy_pass http://backend;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Request-ID $request_id;
    proxy_read_timeout 120s;
    proxy_connect_timeout 5s;
  }

  location /health {
    proxy_pass http://backend/health;
    access_log off;
  }
}
```

---

## 6. Rollback Procedure

### 6.1 Frontend (< 2 minutes)
1. Vercel dashboard → `Deployments` tab
2. Find last known-good deployment
3. Click `···` → `Redeploy`
4. Vercel automatically sets it as production

### 6.2 Backend (< 10 minutes)
```bash
# Find previous SHA
PREV_SHA=$(docker images ${REGISTRY}/launchmind/backend --format "{{.Tag}}" | grep -v latest | head -2 | tail -1)

# Rollback
ssh oracle-vm << EOF
  docker stop launchmind-backend
  docker rm launchmind-backend
  docker run -d \
    --name launchmind-backend \
    --restart unless-stopped \
    --env-file /opt/launchmind/.env \
    -p 3001:3001 \
    ${REGISTRY}/launchmind/backend:${PREV_SHA}
EOF
curl -f https://api.launchmind.com/health
```

### 6.3 Database
Migrations are additive-only — no rollback needed. If a new column causes issues, deploy a new container version that ignores it. Never drop the column.

---

## 7. Disaster Recovery

### 7.1 Full VM Recovery

If Oracle VM is lost:
1. Provision new Oracle Cloud A1 Flex instance (15 min)
2. Install Docker + Nginx (5 min, via `docs/oracle-setup.md`)
3. Create `/opt/launchmind/.env` from AWS Secrets Manager backup (2 min)
4. Pull last known-good Docker image (5 min)
5. Run container (2 min)
6. Update Cloudflare DNS A record to new VM IP (1 min, ~5 min propagation)
7. Total: ~35 min (within 1-hour RTO target)

### 7.2 Database Recovery

Supabase managed daily backups (7-day retention on Pro plan):
1. Supabase dashboard → Project Settings → Database Backups
2. Restore to point-in-time (PITR)
3. New Supabase project URL — update `NEXT_PUBLIC_SUPABASE_URL` in Vercel + VM env
4. Total: ~30 min

### 7.3 Backup Verification

Monthly: restore to a staging Supabase project and verify:
- All 61 migrations applied
- RLS policies present
- Seed data intact
- API health check returns 200 against staging DB

---

## 8. Production Env Gaps (Pre-Launch Actions)

From `project_prod_env_gaps.md` memory:

| Gap | Action | Owner |
|---|---|---|
| Wrong service role key in Docker | Verify `SUPABASE_SERVICE_ROLE_KEY` in `/opt/launchmind/.env` | Ops |
| Migrations 035–061 not pushed to hosted Supabase | `npx supabase db push` | Ops |
| WhatsApp env vars missing | Add `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_ACCESS_TOKEN` | Ops |
| ELEVENLABS_API_KEY not set on VM | Add to `/opt/launchmind/.env` | Ops |
| CREATOMATE_API_KEY not set on VM | Add to `/opt/launchmind/.env` | Ops |
| REPLICATE_API_TOKEN not set on VM | Add to `/opt/launchmind/.env` | Ops |
