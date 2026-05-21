# Phase 6 — Expansion (Months 6–9)

> **Entry criteria:** Phase 5 complete. $2,500 MRR. 50 paying founders. Case study published.

---

## New channels

### YouTube Shorts
- Script generation via Claude Sonnet (30–60 second hook formats)
- Posting via YouTube Data API v3 (OAuth 2.0 + service account)
- Token cost: 25 tokens / script generation
- Targeting: app category + keyword audiences
- Markets: USA (Month 6), India (Month 7)

### X / Twitter
- Organic post generation (thread format + single tweet)
- Posting via X API v2 (OAuth 2.0)
- Token cost: 10 tokens / post batch (5 tweets)
- Markets: USA first; India follow in Month 8

### Reddit
- Subreddit targeting for US apps (r/SideProject, r/AppStore, category subs)
- Organic posts only (no Reddit Ads API in Phase 6)
- Script generation: "genuine question + subtle plug" format
- Token cost: 10 tokens / post draft
- Markets: USA only (Phase 6)

---

## New markets

### SE Asia — Month 6
- **Countries:** Singapore, Malaysia, Indonesia
- **Payments:** Stripe (SGD, MYR, IDR) + GrabPay (via Stripe) + GoPay (via Midtrans)
- **Pricing:** SGD 25/mo (Solo), SGD 65/mo (Builder), SGD 129/mo (Studio)
- **Channels priority:** TikTok + Meta + WhatsApp (highest penetration in region)
- **Migration:** additive — new `market` values, new pricing rows; no existing tables changed

### Nigeria — Month 9
- **Payments:** Paystack (NGN cards + bank transfer) + Flutterwave (mobile money)
- **Pricing:** ₦15,000/mo (Solo), ₦39,000/mo (Builder), ₦79,000/mo (Studio)
- **Channels priority:** WhatsApp + Meta
- **Note:** Review Central Bank of Nigeria fintech rules before launch

---

## Product depth

### Deeper playbook intelligence
- Cross-category pattern mining: identify signals that work across categories (e.g. "pain_first hook + freemium + WhatsApp → high install_delta regardless of category")
- Requires: weekly batch job to update `playbook_signals` from live campaign data
- Model: claude-haiku-4-5-20251001 for signal classification, Sonnet for report generation

### A/B testing framework for ad copy variants
- Per-campaign A/B: generate 2–3 copy variants, track which converts better in `campaign_metrics`
- UI: "Test this copy" button on campaign card → runs 2-week split test
- Winner auto-promoted; loser archived

### App Store Connect + Play Console direct API integration
- Replace UTM-only tracking with direct install attribution
- App Store Connect API (JWT auth): pulls `acquisitionType`, `proceeds`, `installs` per territory
- Play Console API (service account): pulls `user_acquisition_funnel` report
- Reduces reliance on UTM-based counting (misses organic lift)

### LaunchMind mobile app (React Native)
- Founders receive push notifications instead of email for:
  - Brief ready
  - Campaign needs approval
  - Low token warning
- Quick approve/reject campaigns from phone
- Stack: React Native + Expo + Supabase Realtime for push
- Timeline: Month 8 (after SE Asia launch stabilises)

---

## Business / co-founder evaluation

### If MRR > $5K by Month 6
- Evaluate a technical co-founder for a GTM/growth role
- Requirements: strong outbound / content / community background
- Equity range: 10–15% with 4-year vest, 1-year cliff
- Process: 30-day paid trial project before any equity

### If MRR > $10K by Month 9
- Evaluate raising a small pre-seed round ($150–300K)
- Use case: hire 1 full-stack engineer + 1 growth person
- Target investors: angel-led, founder-friendly, India/USA dual-market experience
- Avoid: VCs requiring 10× exit trajectory at pre-seed — product is cashflow-first

---

## Infrastructure upgrades (Phase 6)

| Area | Current (Phase 5) | Phase 6 target |
|---|---|---|
| Oracle VM | 4 OCPU ARM (Always Free) | Upgrade to AMD.E4.Flex (8 OCPU, 16GB) if load demands |
| Redis | Upstash (serverless) | Upstash Pro (dedicated, higher throughput) |
| Scraper worker | Single Playwright worker | Worker pool (3×) for parallel scrapes |
| DB connections | Supabase default pool | PgBouncer transaction mode (for SE Asia burst) |
| CDN | Cloudflare Free | Cloudflare Pro (custom rules + analytics) |

---

## Success metrics for Phase 6 completion

- [ ] 3 new channels live (YouTube Shorts, X, Reddit)
- [ ] SE Asia market open with at least 10 paying founders
- [ ] A/B testing framework: at least 50 campaigns run through it
- [ ] MRR > $10K
- [ ] 150+ paying founders
- [ ] App Store Connect + Play Console APIs replacing UTM for ≥ 50% of products
- [ ] Mobile app in TestFlight / Play internal testing
