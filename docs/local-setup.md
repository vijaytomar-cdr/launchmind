## Local development setup

### Prerequisites
- Node.js 20+
- Docker Desktop
- Supabase CLI: brew install supabase/tap/supabase

### First time setup
1. Clone the repo
2. Create .env.dev and fill in real values (see .env.dev in project root)
3. supabase start — starts local Postgres + Auth on port 54321
4. docker compose up -d — starts API + scraper + Redis + LocalStack (KMS)
5. Copy KMS_KEY_ARN printed by LocalStack into .env.dev
6. cd backend && npm run db:migrate
7. cd app && npm install && npm run dev

### Ports
- Next.js:         http://localhost:3000
- Fastify API:     http://localhost:3001
- Supabase Studio: http://localhost:54323
- Redis:           localhost:6379
- LocalStack KMS:  http://localhost:4566

### Verify
curl http://localhost:3001/health → {"status":"ok"}
