/**
 * @file api.ts
 * @description Type-safe API client for the LaunchMind Fastify backend.
 *   All frontend → backend calls route through this file.
 *   Never calls Supabase directly — that is the backend's job.
 * @security Auth token from Supabase session is attached as Bearer header.
 *   Never logs tokens. All errors surfaced as typed ApiError.
 * @dependencies @supabase/ssr (for session token), fetch
 */

import type { ContentAsset } from '@/lib/types/content';
export type { ContentAsset } from '@/lib/types/content';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /**
     * Machine-readable error code from the server envelope (e.g. 'NEEDS_REAUTH').
     *
     * The server has always sent this; it used to be dropped here, which forced
     * callers to branch on substrings of the human message. Matching on prose meant
     * a copy edit silently changed which recovery screen an owner saw.
     */
    public code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Header carrying the workspace the UI is currently showing.
 *
 * This is CONTEXT, not authorization. The backend independently verifies that the
 * authenticated actor is a member of this workspace and returns 404 otherwise —
 * setting it never grants access to a workspace the caller is not in.
 */
export const WORKSPACE_HEADER = 'x-launchmind-workspace-id';

async function request<T>(
  path: string,
  options: RequestInit & { token?: string; workspaceId?: string } = {}
): Promise<T> {
  const { token, workspaceId, ...fetchOptions } = options;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(fetchOptions.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (workspaceId) headers[WORKSPACE_HEADER] = workspaceId;

  const response = await fetch(`${API_BASE}${path}`, {
    ...fetchOptions,
    headers,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new ApiError(response.status, body.error ?? response.statusText, body.code);
  }

  return response.json() as Promise<T>;
}

/**
 * Like `request<T>` but for routes that use the ok() envelope.
 * Automatically strips `{ ok: true, data: T }` and returns just T.
 */
async function requestData<T>(
  path: string,
  options: RequestInit & { token?: string; workspaceId?: string } = {}
): Promise<T> {
  const envelope = await request<{ ok: boolean; data: T; error?: string; code?: string }>(path, options);
  if (!envelope.ok) throw new ApiError(0, envelope.error ?? 'Request failed', envelope.code);
  return envelope.data;
}

export const api = {
  health: () => request<{ status: string; timestamp: string }>('/health'),

  products: {
    // Legacy single-URL sync scrape (backward compat)
    scrape: (url: string, token: string) =>
      request<ScrapeResult>('/products/scrape', {
        method: 'POST',
        body: JSON.stringify({ url }),
        token,
      }),
    // v2 multi-URL async scrape — returns { productId, jobId, status: 'queued' }
    scrapeMulti: (
      urls: { playStoreUrl?: string; appStoreUrl?: string; websiteUrl?: string; storeUrl?: string },
      token: string
    ) => {
      const { storeUrl, ...rest } = urls;
      return request<AsyncScrapeResult>('/products/scrape', {
        method: 'POST',
        body: JSON.stringify(storeUrl ? { ...rest, url: storeUrl } : rest),
        token,
      });
    },
    // Poll job status — returns ScrapeJobStatus
    pollScrapeJob: (jobId: string, token: string) =>
      request<import('./types/intake').ScrapeJobStatus>(`/products/scrape/${jobId}`, { token }),
    // Scrape metadata from a competitor website URL (non-store competitor — Gap 2 fix)
    scrapeCompetitorWebsite: (url: string, token: string) =>
      request<ScrapeResult>('/products/competitor/website', {
        method: 'POST',
        body: JSON.stringify({ url }),
        token,
      }),
    // Save founder context answers
    saveContext: (productId: string, context: import('./types/intake').FounderContext, token: string) =>
      request<{ id: string; intake_step: number }>('/products/intake/context', {
        method: 'POST',
        body: JSON.stringify({ productId, founderContext: context }),
        token,
      }),
    // Analyse screenshots — converts Files to base64 before sending
    uploadScreenshots: async (productId: string, files: File[], token: string) => {
      const screenshots = await Promise.all(
        files.map(
          (f) =>
            new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsDataURL(f);
            })
        )
      );
      return request<{ id: string; intake_step: number; screenshot_analysis: unknown }>(
        '/products/intake/screenshots',
        { method: 'POST', body: JSON.stringify({ productId, screenshots }), token }
      );
    },
    // v2 confirm — UPDATE existing product (productId required) or legacy INSERT
    confirmEnriched: (
      data: {
        productId: string;
        icpBrief: ICPBrief;
        competitorSet?: CompetitorApp[];
        selectedMarkets?: string[];
        primaryChannel?: string;
        excludedChannels?: string[];
        logoUrl?: string;
        includeLogo?: boolean;
      },
      token: string
    ) =>
      request<Product>('/products/confirm', {
        method: 'POST',
        body: JSON.stringify({
          productId: data.productId,
          icpBrief: data.icpBrief,
          competitors: data.competitorSet ?? [],
          selectedMarkets: data.selectedMarkets,
          primaryChannel: data.primaryChannel,
          excludedChannels: data.excludedChannels,
          logoUrl: data.logoUrl,
          includeLogo: data.includeLogo,
        }),
        token,
      }),
    // Legacy confirm
    confirm: (data: ConfirmProductBody, token: string) =>
      request<Product>('/products/confirm', {
        method: 'POST',
        body: JSON.stringify(data),
        token,
      }),
    list: (token: string) => request<Product[]>('/products', { token }),
    get: (id: string, token: string) =>
      request<Product>(`/products/${id}`, { token }),
    metrics: (id: string, token: string, weekCount = 8) =>
      request<ProductMetrics>(`/products/${id}/metrics?weekCount=${weekCount}`, { token }),
    getStrategy: (id: string, token: string) =>
      request<Record<string, unknown>>(`/products/${id}/strategy`, { token }),
    generateStrategy: (id: string, token: string, opts?: { budgetOverride?: string }) =>
      request<Record<string, unknown>>(`/products/${id}/strategy`, {
        method: 'POST',
        body: opts?.budgetOverride ? JSON.stringify({ budgetOverride: opts.budgetOverride }) : '{}',
        token,
      }),
    generateAssets: (id: string, channel: string, market: string, token: string) =>
      request<Record<string, unknown>>(`/products/${id}/strategy/assets`, {
        method: 'POST',
        body: JSON.stringify({ channel, market }),
        token,
      }),
    inProgress: (token: string) =>
      request<{ product: { id: string; name: string; store_url: string; play_store_url: string | null; app_store_url: string | null; intake_step: number | null; created_at: string } | null }>('/products/in-progress', { token }),
    abandon: (id: string, token: string) =>
      request<void>(`/products/${id}/abandon`, { method: 'DELETE', body: '{}', token }),
    rescrape: (id: string, token: string) =>
      request<{ jobId: string }>(`/products/${id}/rescrape`, { method: 'POST', body: '{}', token }),
    listArchived: (token: string) =>
      request<Product[]>('/products/archived', { token }),
    archive: (id: string, token: string) =>
      request<{ ok: boolean }>(`/products/${id}/archive`, { method: 'POST', body: '{}', token }),
    restore: (id: string, token: string) =>
      request<{ ok: boolean }>(`/products/${id}/restore`, { method: 'POST', body: '{}', token }),
    deletePermanently: (id: string, token: string) =>
      request<void>(`/products/${id}`, { method: 'DELETE', body: JSON.stringify({ confirmation: 'DELETE' }), token }),
    activate: (id: string, token: string) =>
      request<{ ok: boolean }>(`/products/${id}/activate`, { method: 'POST', body: '{}', token }),
    // Intake V3
    setupStart: (data: {
      name: string; category?: string; stage?: string; primary_language?: string;
      country?: string; store_url?: string; platform?: string; workspace_id?: string;
    }, token: string) =>
      request<{ product: { id: string; name: string; intake_v3_step: number; created_at: string } }>(
        '/products/setup/start', { method: 'POST', body: JSON.stringify(data), token },
      ),
    saveIntakeStep: (id: string, step: number, data: Record<string, unknown>, token: string) =>
      request<{ product: { id: string; intake_v3_step: number } }>(
        `/products/${id}/intake/step/${step}`, { method: 'PATCH', body: JSON.stringify(data), token },
      ),
    completeIntake: (id: string, token: string) =>
      request<{ product: { id: string; name: string; intake_v3_step: number; intake_v3_complete_at: string } }>(
        `/products/${id}/intake/complete`, { method: 'POST', body: '{}', token },
      ),
    intakeStatus: (id: string, token: string) =>
      request<{ id: string; name: string; step: number; complete: boolean; complete_at: string | null }>(
        `/products/${id}/intake/status`, { token },
      ),
    updateContext: (productId: string, body: { positioning?: string; audience?: string; topSignal?: string }, token: string) =>
      request<{ ok: boolean; data: { id: string; confirmed_icp: Record<string, unknown> } }>(
        `/products/${productId}/context`, { method: 'PATCH', body: JSON.stringify(body), token }
      ),
    updateContextDelta: (productId: string, body: { nextInitiative?: string; primaryGoal?: string; targetWindow?: string }, token: string) =>
      request<{ ok: boolean; data: Record<string, unknown> }>(
        `/products/${productId}/context-delta`, { method: 'PATCH', body: JSON.stringify(body), token }
      ),
  },

  channels: {
    list: (token: string) =>
      request<{ channels: ConnectedChannel[] }>('/channels', { token }),
    oauthInit: (token: string) =>
      request<{ url: string }>('/channels/whatsapp/oauth/init', { token }),
    revoke: (platform: SupportedPlatform, token: string) =>
      request<{ success: boolean; platform: string; revokedAt: string }>(
        `/channels/${platform}`,
        { method: 'DELETE', token }
      ),
  },

  utm: {
    create: (campaignId: string, body: CreateUTMLinkBody, token: string) =>
      request<UTMLink>(`/campaigns/${campaignId}/utm-link`, {
        method: 'POST',
        body: JSON.stringify(body),
        token,
      }),
    list: (campaignId: string, token: string) =>
      request<{ links: UTMLink[] }>(`/campaigns/${campaignId}/utm-links`, { token }),
  },

  campaigns: {
    list: (token: string) =>
      request<{ campaigns: Campaign[] }>('/campaigns', { token }),

    // M09 new methods
    create: (body: {
      productId: string;
      type: string;
      channel: string;
      market: 'usa' | 'india';
      hookType?: string;
      copyText?: string;
      missionId?: string;
      spendCap?: Record<string, unknown>;
      scheduledAt?: string;
    }, token: string) =>
      request<{ campaign: CampaignDetail }>('/campaigns/create', { method: 'POST', body: JSON.stringify(body), token }),

    detail: (id: string, token: string) =>
      request<{
        campaign: CampaignDetail;
        assets: ContentAsset[];
        metrics: CampaignMetric[];
        approvalHistory: CampaignApproval[];
        publishAttempts: PublishAttempt[];
      }>(`/campaigns/${id}/detail`, { token }),

    update: (id: string, body: {
      hookType?: string;
      copyText?: string;
      spendCap?: Record<string, unknown>;
      scheduledAt?: string;
      audienceConfig?: Record<string, unknown>;
    }, token: string) =>
      request<{ campaign: CampaignDetail }>(`/campaigns/${id}`, { method: 'PUT', body: JSON.stringify(body), token }),

    generatePlan: (id: string, token: string) =>
      request<{ plan: Record<string, unknown> }>(`/campaigns/${id}/plan`, { method: 'POST', body: '{}', token }),

    schedule: (id: string, scheduledAt: string, token: string) =>
      request<{ campaign: CampaignDetail }>(`/campaigns/${id}/schedule`, { method: 'POST', body: JSON.stringify({ scheduledAt }), token }),

    launch: (id: string, token: string) =>
      request<{ campaign: CampaignDetail }>(`/campaigns/${id}/launch`, { method: 'POST', body: '{}', token }),

    resume: (id: string, token: string) =>
      request<{ campaign: CampaignDetail }>(`/campaigns/${id}/resume`, { method: 'POST', body: '{}', token }),

    cancel: (id: string, token: string) =>
      request<{ campaign: CampaignDetail }>(`/campaigns/${id}/cancel`, { method: 'POST', body: '{}', token }),

    archive: (id: string, token: string) =>
      request<{ id: string; archivedAt: string }>(`/campaigns/${id}/archive`, { method: 'POST', body: '{}', token }),

    linkAsset: (id: string, assetId: string, token: string) =>
      request<{ linked: boolean; assetId: string; campaignId: string }>(`/campaigns/${id}/assets`, {
        method: 'POST', body: JSON.stringify({ assetId }), token,
      }),
  },

  experiments: {
    create: (body: {
      productId: string;
      title: string;
      hypothesis: string;
      experimentType: 'copy' | 'creative' | 'channel' | 'aso' | 'audience';
      goal: string;
      metric: string;
      campaignId?: string;
      missionId?: string;
      market?: 'usa' | 'india' | 'both';
      startDate?: string;
      endDate?: string;
      expectedOutcome?: string;
      variantA: { assetId?: string; label?: string; description?: string; config?: Record<string, unknown> };
      variantB: { assetId?: string; label?: string; description?: string; config?: Record<string, unknown> };
    }, token: string) =>
      request<{ experiment: Experiment }>('/experiments', { method: 'POST', body: JSON.stringify(body), token }),

    list: (token: string, params?: { status?: string; limit?: number; offset?: number }) => {
      const qs = new URLSearchParams();
      if (params?.status) qs.set('status', params.status);
      if (params?.limit)  qs.set('limit', String(params.limit));
      if (params?.offset) qs.set('offset', String(params.offset));
      const q = qs.toString();
      return request<{ experiments: Experiment[]; total: number }>(`/experiments${q ? '?' + q : ''}`, { token });
    },

    get: (id: string, token: string) =>
      request<{ experiment: Experiment; variants: ExperimentVariant[] }>(`/experiments/${id}`, { token }),

    start: (id: string, token: string) =>
      request<{ experiment: Pick<Experiment, 'id' | 'status' | 'start_date'> }>(`/experiments/${id}/start`, { method: 'POST', body: '{}', token }),

    updateResults: (id: string, body: {
      variant: 'a' | 'b';
      impressions?: number;
      clicks?: number;
      conversions?: number;
      metricValue?: number;
    }, token: string) =>
      request<{ updated: boolean; variant: string }>(`/experiments/${id}/results`, { method: 'POST', body: JSON.stringify(body), token }),

    selectWinner: (id: string, body: {
      winner: 'a' | 'b' | 'inconclusive';
      winnerConfidence?: number;
      learning: string;
    }, token: string) =>
      request<{ experiment: Experiment; learningSummary: string }>(`/experiments/${id}/winner`, { method: 'POST', body: JSON.stringify(body), token }),

    archive: (id: string, token: string) =>
      request<{ id: string; archivedAt: string }>(`/experiments/${id}/archive`, { method: 'POST', body: '{}', token }),
  },

  calendar: {
    list: (token: string, params?: { from?: string; to?: string; productId?: string; type?: string }) => {
      const qs = new URLSearchParams();
      if (params?.from)      qs.set('from', params.from);
      if (params?.to)        qs.set('to', params.to);
      if (params?.productId) qs.set('productId', params.productId);
      if (params?.type)      qs.set('type', params.type);
      const q = qs.toString();
      return request<{ events: CalendarEvent[]; from: string; to: string; total: number }>(`/calendar${q ? '?' + q : ''}`, { token });
    },

    create: (body: {
      type: string;
      title: string;
      startDate: string;
      endDate?: string;
      allDay?: boolean;
      description?: string;
      productId?: string;
      campaignId?: string;
      experimentId?: string;
      timezone?: string;
      metadata?: Record<string, unknown>;
    }, token: string) =>
      request<{ event: CalendarEvent }>('/calendar', { method: 'POST', body: JSON.stringify(body), token }),

    update: (id: string, body: {
      title?: string;
      description?: string;
      startDate?: string;
      endDate?: string | null;
      allDay?: boolean;
      status?: 'scheduled' | 'completed' | 'missed' | 'cancelled';
      metadata?: Record<string, unknown>;
    }, token: string) =>
      request<{ event: CalendarEvent }>(`/calendar/${id}`, { method: 'PUT', body: JSON.stringify(body), token }),

    delete: (id: string, token: string) =>
      request<void>(`/calendar/${id}`, { method: 'DELETE', token }),
  },

  // ── M10: Recommendation Engine ──────────────────────────────────────────────
  recommendations: {
    list: (token: string, params?: { productId?: string; type?: string; limit?: number }) => {
      const qs = new URLSearchParams();
      if (params?.productId) qs.set('productId', params.productId);
      if (params?.type)      qs.set('type', params.type);
      if (params?.limit)     qs.set('limit', String(params.limit));
      const q = qs.toString();
      return request<{ recommendations: Recommendation[]; total: number }>(`/recommendations${q ? '?' + q : ''}`, { token });
    },

    generate: (productId: string, token: string) =>
      request<{ created: number; skipped: number; productId: string }>('/recommendations/generate', {
        method: 'POST', body: JSON.stringify({ productId }), token,
      }),

    dismiss: (id: string, token: string) =>
      request<{ recommendation: Recommendation }>(`/recommendations/${id}/dismiss`, {
        method: 'PATCH', body: '{}', token,
      }),

    save: (id: string, token: string) =>
      request<{ recommendation: Recommendation }>(`/recommendations/${id}/save`, {
        method: 'PATCH', body: '{}', token,
      }),

    convert: (id: string, body: { title?: string; objective?: string }, token: string) =>
      request<{ mission: { id: string; title: string; status: string }; recommendationId: string }>(
        `/recommendations/${id}/convert`, { method: 'POST', body: JSON.stringify(body), token }
      ),

    history: (token: string, params?: { productId?: string; state?: string; limit?: number }) => {
      const qs = new URLSearchParams();
      if (params?.productId) qs.set('productId', params.productId);
      if (params?.state)     qs.set('state', params.state);
      if (params?.limit)     qs.set('limit', String(params.limit));
      const q = qs.toString();
      return request<{ recommendations: Recommendation[]; total: number }>(`/recommendations/history${q ? '?' + q : ''}`, { token });
    },

    feedback: (id: string, body: { feedbackType: RecommendationFeedbackType; note?: string }, token: string) =>
      request<{ feedback: { recommendationId: string; feedbackType: string } }>(
        `/recommendations/${id}/feedback`, { method: 'POST', body: JSON.stringify(body), token }
      ),
  },

  // ── M10: Intelligence Benchmarks ────────────────────────────────────────────
  benchmarks: {
    get: (params: { category: string; market: string; channel?: string }, token: string) => {
      const qs = new URLSearchParams({ category: params.category, market: params.market });
      if (params.channel) qs.set('channel', params.channel);
      return request<{ benchmark: BenchmarkResult | null; message?: string }>(`/benchmarks?${qs}`, { token });
    },

    categories: (token: string) =>
      request<{ categories: { category: string; market: string; count: number }[] }>('/benchmarks/categories', { token }),

    trends: (params: { category: string; market: string; period?: 30 | 90 }, token: string) => {
      const qs = new URLSearchParams({ category: params.category, market: params.market });
      if (params.period) qs.set('period', String(params.period));
      return request<{ trends: TrendSummary[]; category: string; market: string; periodDays: number }>(`/benchmarks/trends?${qs}`, { token });
    },

    summary: (token: string) =>
      request<{ summaries: BenchmarkSummary[] }>('/benchmarks/summary', { token }),
  },

  briefs: {
    list: (token: string) =>
      request<{ briefs: WeeklyBrief[] }>('/briefs', { token }),
  },

  feedback: {
    submit: (
      data: { rating: number; body?: string; context?: string; productId?: string },
      token: string
    ) =>
      request<{ id: string; rating: number }>('/feedback', {
        method: 'POST',
        body: JSON.stringify(data),
        token,
      }),
  },

  billing: {
    checkout: (data: CheckoutBody, token: string) =>
      request<CheckoutResult>('/billing/checkout', {
        method: 'POST',
        body: JSON.stringify(data),
        token,
      }),
    subscription: (token: string) =>
      request<SubscriptionStatus>('/billing/subscription', { token }),
    cancel: (token: string) =>
      request<{ message: string }>('/billing/cancel', {
        method: 'POST',
        body: '{}',
        token,
      }),
    topup: (data: TokenTopupBody, token: string) =>
      request<TokenTopupResult>('/billing/topup', {
        method: 'POST',
        body: JSON.stringify(data),
        token,
      }),
  },

  workspaces: {
    list: (token: string) =>
      request<{ workspaces: Workspace[] }>('/workspaces', { token }),
    get: (id: string, token: string) =>
      request<{ workspace: Workspace }>(`/workspaces/${id}`, { token }),
    create: (data: { name: string; client_name?: string }, token: string) =>
      request<{ workspace: Workspace }>('/workspaces', {
        method: 'POST', body: JSON.stringify(data), token,
      }),
    update: (id: string, data: { name?: string; client_name?: string | null }, token: string) =>
      request<{ workspace: Workspace }>(`/workspaces/${id}`, {
        method: 'PATCH', body: JSON.stringify(data), token,
      }),
    delete: (id: string, token: string) =>
      request<{ deleted: boolean }>(`/workspaces/${id}`, { method: 'DELETE', token }),
    products: (id: string, token: string) =>
      request<{ products: Product[] }>(`/workspaces/${id}/products`, { token }),
    assignProduct: (workspaceId: string, productId: string, token: string) =>
      request<{ assigned: boolean }>(`/workspaces/${workspaceId}/products/${productId}`, {
        method: 'POST', body: '{}', token,
      }),
    activate: (id: string, token: string) =>
      request<{ ok: boolean }>(`/workspaces/${id}/activate`, { method: 'POST', body: '{}', token }),
    listMembers: (id: string, token: string) =>
      request<{ members: WorkspaceMember[] }>(`/workspaces/${id}/members`, { token }),
    inviteMember: (id: string, data: { email: string; role: string }, token: string) =>
      request<{ member: WorkspaceMember }>(`/workspaces/${id}/members`, {
        method: 'POST', body: JSON.stringify(data), token,
      }),
    removeMember: (workspaceId: string, memberId: string, token: string) =>
      request<void>(`/workspaces/${workspaceId}/members/${memberId}`, { method: 'DELETE', token }),
  },

  integrations: {
    list: (token: string) =>
      request<{ integrations: Integration[] }>('/integrations', { token }),
    connections: (token: string) =>
      request<{ connections: Phase2Connections }>('/integrations/connections', { token }),
    capabilityStatus: (token: string) =>
      request<{ status: CapabilityStatus }>('/integrations/capability-status', { token }),
    connectGa4: (data: { api_key: string; integration_config: Record<string, unknown> }, token: string) =>
      request<{ integration: { id: string; platform: string } }>('/integrations/ga4', {
        method: 'POST', body: JSON.stringify(data), token,
      }),
    connectFirebase: (data: { api_key: string; integration_config: Record<string, unknown> }, token: string) =>
      request<{ integration: { id: string; platform: string } }>('/integrations/firebase', {
        method: 'POST', body: JSON.stringify(data), token,
      }),
    connectWebsite: (data: { url: string }, token: string) =>
      request<{ integration: { id: string; platform: string } }>('/integrations/website', {
        method: 'POST', body: JSON.stringify(data), token,
      }),
    connectAppStoreConnect: (data: { api_key: string; issuer_id?: string; key_id?: string }, token: string) =>
      request<{ integration: { id: string; platform: string } }>('/integrations/app-store-connect', {
        method: 'POST', body: JSON.stringify(data), token,
      }),
    connectRevenueCat: (data: { api_key: string; app_id?: string }, token: string) =>
      request<{ integration: { id: string; platform: string } }>('/integrations/revenue-cat', {
        method: 'POST', body: JSON.stringify(data), token,
      }),
    googleAdsOAuthInit: (token: string) =>
      request<{ url: string }>('/integrations/google-ads/oauth/init', { token }),
    metaAdsOAuthInit: (token: string) =>
      request<{ url: string }>('/integrations/meta-ads/oauth/init', { token }),
    disconnect: (platform: string, token: string) =>
      request<void>(`/integrations/${platform}`, { method: 'DELETE', token }),
  },

  apiKeys: {
    list: (token: string) =>
      request<{ keys: ApiKey[] }>('/api-keys', { token }),
    create: (data: { name: string; scopes: string[]; expires_at?: string }, token: string) =>
      request<ApiKey & { key: string }>('/api-keys', {
        method: 'POST', body: JSON.stringify(data), token,
      }),
    revoke: (id: string, token: string) =>
      request<{ revoked: boolean; id: string }>(`/api-keys/${id}`, {
        method: 'DELETE', token,
      }),
  },

  founders: {
    /**
     * POST /founders/session — idempotent session init.
     * Call after every login/signup. Guarantees workspace exists.
     * Returns founder profile + personal workspace.
     */
    sessionInit: (token: string) =>
      request<{
        founder: Founder;
        workspace: Workspace;
        workspaceCreated: boolean;
      }>('/founders/session', { method: 'POST', body: '{}', token }),
    me: (token: string) =>
      request<{ founder: Founder }>('/founders/me', { token }),
    insights: (token: string) =>
      request<FounderInsights>('/founders/me/insights', { token }),
    export: (token: string) =>
      request<Record<string, unknown>>('/founders/me/export', { token }),
    deleteAccount: (token: string) =>
      request<{ deleted: boolean }>('/founders/me', { method: 'DELETE', token }),
    updateNotifications: (data: { briefDelivery?: boolean; campaignApproval?: boolean; lowTokenWarning?: boolean }, token: string) =>
      request<{ updated: boolean }>('/founders/me/notifications', {
        method: 'PATCH', body: JSON.stringify(data), token,
      }),
    revokeSessions: (token: string) =>
      request<{ revoked: boolean }>('/auth/revoke-sessions', { method: 'POST', body: '{}', token }),
    tokenUsage: (token: string) =>
      request<TokenUsage>('/founders/me/token-usage', { token }),
    resume: (token: string) =>
      requestData<{ hasResume: boolean; product?: { id: string; name: string; intake_step: number; step_label: string; store_url: string; updated_at: string } }>('/founders/me/resume', { token }),
  },

  brandVoice: {
    preview: (productId: string, copy: string, token: string) =>
      request<BrandVoicePreview>(`/products/${productId}/brand-voice/preview`, {
        method: 'POST', body: JSON.stringify({ copy }), token,
      }),
  },

  contentAssets: {
    list: (
      productId: string,
      token: string,
      params?: { status?: string; channel?: string; limit?: number; offset?: number }
    ) => {
      const qs = params ? '?' + new URLSearchParams(Object.fromEntries(
        Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])
      )).toString() : '';
      return request<{ assets: import('./types/content').ContentAsset[]; total: number }>(
        `/products/${productId}/content-assets${qs}`,
        { token }
      );
    },
    approve: (id: string, token: string) =>
      request<{ asset: { id: string; status: string } }>(`/content-assets/${id}/approve`, { method: 'POST', body: '{}', token }),
    hold: (id: string, token: string) =>
      request<{ asset: { id: string; status: string } }>(`/content-assets/${id}/hold`, { method: 'POST', body: '{}', token }),
    approveAll: (productId: string, token: string) =>
      request<{ approved: number }>(`/products/${productId}/content-assets/approve-all`, { method: 'POST', body: '{}', token }),
    regenerate: (id: string, token: string, reason: string, additionalNote?: string) =>
      request<{ message: string }>(`/content-assets/${id}/regenerate`, {
        method: 'POST',
        body: JSON.stringify({ reason, additionalNote }),
        token,
      }),
    generate: (productId: string, token: string, force = false) =>
      request<{ message: string; total?: number }>(`/products/${productId}/content${force ? '?force=true' : ''}`, { method: 'POST', body: '{}', token }),
    render: (assetId: string, token: string) =>
      request<{ message: string; assetId: string }>(`/content-assets/${assetId}/render`, { method: 'POST', body: '{}', token }),
    generateImage: (assetId: string, token: string, style?: 'photorealistic' | 'graphic' | 'mockup') =>
      request<{ message: string; assetId: string; style: string }>(
        `/content-assets/${assetId}/generate-image${style ? `?style=${style}` : ''}`,
        { method: 'POST', body: '{}', token }
      ),
  },

  settings: {
    updateContentPreferences: (
      productId: string,
      preferences: import('./types/content').ContentPreferences,
      token: string
    ) =>
      request<{ preferences: import('./types/content').ContentPreferences }>(
        '/settings/content-preferences',
        { method: 'POST', body: JSON.stringify({ productId, preferences }), token }
      ),
    uploadVoiceClone: (audioBase64: string, token: string) =>
      request<{ voiceCloneId: string }>('/settings/voice-clone', {
        method: 'POST',
        body: JSON.stringify({ audioBase64 }),
        token,
      }),
    deleteVoiceClone: (token: string) =>
      request<void>('/settings/voice-clone', { method: 'DELETE', token }),
  },

  memory: {
    list: (token: string, params?: {
      product_id?: string; memory_type?: string; status?: string; limit?: number; offset?: number;
    }) => {
      const qs = params ? '?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString() : '';
      return request<{ memories: MarketingMemory[]; total: number }>(`/memory${qs}`, { token });
    },
    get: (id: string, token: string) =>
      request<{ memory: MarketingMemory & { versions: MarketingMemoryVersion[] } }>(`/memory/${id}`, { token }),
    create: (body: {
      product_id?: string; memory_type: string; title: string;
      content: Record<string, unknown>; source: string; confidence?: number;
    }, token: string) =>
      request<{ memory: MarketingMemory }>('/memory', { method: 'POST', body: JSON.stringify(body), token }),
    update: (id: string, body: {
      title?: string; content?: Record<string, unknown>; confidence?: number;
      change_note?: string; changed_by?: 'ai' | 'founder' | 'system';
    }, token: string) =>
      request<{ memory: MarketingMemory }>(`/memory/${id}`, { method: 'PATCH', body: JSON.stringify(body), token }),
    archive: (id: string, token: string) =>
      request<void>(`/memory/${id}`, { method: 'DELETE', token }),
    search: (q: string, token: string, params?: { product_id?: string; memory_type?: string; limit?: number }) => {
      const qs = '?' + new URLSearchParams({ q, ...Object.fromEntries(Object.entries(params ?? {}).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])) }).toString();
      return request<{ memories: MarketingMemory[] }>(`/memory/search${qs}`, { token });
    },
    ingestEvent: (body: {
      product_id?: string; event_type: string; payload: Record<string, unknown>;
    }, token: string) =>
      request<{ result: LearningEventResult }>('/memory/events', { method: 'POST', body: JSON.stringify(body), token }),
    listEvents: (token: string, params?: { product_id?: string; limit?: number }) => {
      const qs = params ? '?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString() : '';
      return request<{ events: LearningEvent[]; total: number }>(`/memory/events${qs}`, { token });
    },
    merge: (keepId: string, discardId: string, token: string) =>
      request<{ memory: MarketingMemory }>(`/memory/${keepId}/merge/${discardId}`, { method: 'POST', body: '{}', token }),
  },

  knowledge: {
    graph: (token: string, productId?: string) => {
      const qs = productId ? `?product_id=${productId}` : '';
      return request<{ graph: KnowledgeGraph }>(`/knowledge/graph${qs}`, { token });
    },
    getNode: (id: string, token: string) =>
      request<{ node: KnowledgeNode & { outgoing: KnowledgeEdge[]; incoming: KnowledgeEdge[] } }>(`/knowledge/nodes/${id}`, { token }),
    createNode: (body: {
      product_id?: string; node_type: string; label: string;
      properties?: Record<string, unknown>; source_id?: string; source_type?: string; confidence?: number;
    }, token: string) =>
      request<{ node: KnowledgeNode }>('/knowledge/nodes', { method: 'POST', body: JSON.stringify(body), token }),
    createEdge: (body: {
      source_id: string; target_id: string; relationship: string;
      weight?: number; properties?: Record<string, unknown>;
    }, token: string) =>
      request<{ edge: KnowledgeEdge }>('/knowledge/edges', { method: 'POST', body: JSON.stringify(body), token }),
    deleteNode: (id: string, token: string) =>
      request<void>(`/knowledge/nodes/${id}`, { method: 'DELETE', token }),
    deleteEdge: (id: string, token: string) =>
      request<void>(`/knowledge/edges/${id}`, { method: 'DELETE', token }),
    mergeNodes: (keepId: string, discardId: string, token: string) =>
      request<{ node: KnowledgeNode }>(`/knowledge/nodes/${keepId}/merge/${discardId}`, { method: 'POST', body: '{}', token }),
  },

  ai: {
    context: (productId: string, token: string) =>
      request<{ data: AIContextPackage }>(`/ai/context/${productId}`, { token }),
    prompts: (token: string) =>
      request<{ data: AIPrompt[] }>('/ai/prompts', { token }),
    promptVersions: (promptId: string, token: string) =>
      request<{ data: AIPrompt[] }>(`/ai/prompts/${promptId}/versions`, { token }),
    registerPrompt: (body: {
      promptId: string; purpose: string; model: 'sonnet' | 'haiku';
      userTemplate: string; systemTemplate?: string; tokenCost?: number; status?: 'draft' | 'active';
    }, token: string) =>
      request<{ data: AIPrompt }>('/ai/prompts', { method: 'POST', body: JSON.stringify(body), token }),
    audit: (token: string, params?: { limit?: number; offset?: number; promptId?: string; status?: string }) => {
      const qs = new URLSearchParams();
      if (params?.limit)    qs.set('limit', String(params.limit));
      if (params?.offset)   qs.set('offset', String(params.offset));
      if (params?.promptId) qs.set('promptId', params.promptId);
      if (params?.status)   qs.set('status', params.status);
      const q = qs.toString();
      return request<{ data: { requests: AIRequest[]; total: number; limit: number; offset: number } }>(`/ai/audit${q ? '?' + q : ''}`, { token });
    },
    auditStats: (token: string) =>
      request<{ data: AIAuditStats }>('/ai/audit/stats', { token }),
  },

  missions: {
    create: (body: {
      type: string; title: string; productId?: string; workspaceId?: string;
      input?: Record<string, unknown>; triggerType?: string;
      scheduledAt?: string; priority?: number; idempotencyKey?: string;
    }, token: string) =>
      request<{ mission: Mission }>('/missions', { method: 'POST', body: JSON.stringify(body), token }),

    list: (token: string, params?: { productId?: string; status?: string; type?: string; limit?: number; offset?: number }) => {
      const qs = new URLSearchParams();
      if (params?.productId) qs.set('productId', params.productId);
      if (params?.status)    qs.set('status', params.status);
      if (params?.type)      qs.set('type', params.type);
      if (params?.limit)     qs.set('limit', String(params.limit));
      if (params?.offset)    qs.set('offset', String(params.offset));
      const q = qs.toString();
      return request<{ missions: Mission[]; total: number }>(`/missions${q ? '?' + q : ''}`, { token });
    },

    get: (id: string, token: string) =>
      request<{ mission: Mission; steps: MissionStep[] }>(`/missions/${id}`, { token }),

    timeline: (id: string, token: string) =>
      request<{ mission: Mission; timeline: Array<(MissionStep | MissionLog) & { _kind: 'step' | 'log' }> }>(`/missions/${id}/timeline`, { token }),

    logs: (id: string, token: string) =>
      request<{ logs: MissionLog[] }>(`/missions/${id}/logs`, { token }),

    approvals: (token: string) =>
      request<{ approvals: MissionApproval[] }>('/missions/approvals', { token }),

    cancel: (id: string, token: string) =>
      request<{ success: boolean }>(`/missions/${id}/cancel`, { method: 'POST', body: '{}', token }),

    retry: (id: string, token: string) =>
      request<{ success: boolean }>(`/missions/${id}/retry`, { method: 'POST', body: '{}', token }),

    respond: (id: string, stepId: string, response: 'approved' | 'rejected', responseNote: string | undefined, token: string) =>
      request<{ success: boolean; response: string }>(`/missions/${id}/approvals/${stepId}`, {
        method: 'POST', body: JSON.stringify({ response, responseNote }), token,
      }),
  },

  owner: {
    brief: (token: string) =>
      request<BriefResponse>('/owner/brief', { token }),

    opportunities: (token: string, params?: { state?: string; productId?: string }) => {
      const qs = new URLSearchParams();
      if (params?.state)     qs.set('state', params.state);
      if (params?.productId) qs.set('productId', params.productId);
      const q = qs.toString();
      return request<{ opportunities: Opportunity[] }>(`/owner/opportunities${q ? '?' + q : ''}`, { token });
    },

    createOpportunity: (body: Partial<Opportunity> & { title: string; type: string }, token: string) =>
      request<{ opportunity: Opportunity }>('/owner/opportunities', { method: 'POST', body: JSON.stringify(body), token }),

    updateOpportunity: (id: string, body: { state?: Opportunity['state']; missionId?: string }, token: string) =>
      request<{ success: boolean }>(`/owner/opportunities/${id}`, { method: 'PATCH', body: JSON.stringify(body), token }),

    ask: (question: string, token: string, productId?: string) =>
      request<{ answer: AskResponse; contextSources: string[]; question: string }>('/owner/ask', {
        method: 'POST', body: JSON.stringify({ question, productId }), token,
      }),

    results: (token: string) =>
      request<ResultsSummary>('/owner/results', { token }),

    timeline: (token: string, params?: { limit?: number; offset?: number }) => {
      const qs = new URLSearchParams();
      if (params?.limit)  qs.set('limit', String(params.limit));
      if (params?.offset) qs.set('offset', String(params.offset));
      const q = qs.toString();
      return request<{ events: TimelineEvent[]; total: number }>(`/owner/timeline${q ? '?' + q : ''}`, { token });
    },

    notifications: (token: string) =>
      request<{ notifications: Notification[]; unreadCount: number }>('/owner/notifications', { token }),

    markRead: (id: string, token: string) =>
      request<{ success: boolean }>(`/owner/notifications/${id}/read`, { method: 'PATCH', body: '{}', token }),
  },

  studio: {
    generate: (body: {
      productId: string;
      assetType: string;
      channel: string;
      market?: 'usa' | 'india' | 'both';
      language?: string;
      missionId?: string;
      tone?: string;
      keywords?: string[];
      context?: string;
    }, token: string) =>
      request<{ asset: ContentAsset }>('/studio/generate', { method: 'POST', body: JSON.stringify(body), token }),

    listAssets: (token: string, params?: {
      search?: string;
      type?: string;
      status?: string;
      channel?: string;
      market?: string;
      language?: string;
      missionId?: string;
      tags?: string;
      includeArchived?: boolean;
      limit?: number;
      offset?: number;
    }) => {
      const qs = new URLSearchParams();
      if (params?.search)          qs.set('search', params.search);
      if (params?.type)            qs.set('type', params.type);
      if (params?.status)          qs.set('status', params.status);
      if (params?.channel)         qs.set('channel', params.channel);
      if (params?.market)          qs.set('market', params.market);
      if (params?.language)        qs.set('language', params.language);
      if (params?.missionId)       qs.set('missionId', params.missionId);
      if (params?.tags)            qs.set('tags', params.tags);
      if (params?.includeArchived) qs.set('includeArchived', 'true');
      if (params?.limit)           qs.set('limit', String(params.limit));
      if (params?.offset)          qs.set('offset', String(params.offset));
      const q = qs.toString();
      return request<{ assets: ContentAsset[]; total: number; limit: number; offset: number }>(
        `/studio/assets${q ? '?' + q : ''}`, { token }
      );
    },

    getAsset: (id: string, token: string) =>
      request<{ asset: ContentAsset; versionCount: number; publishTargets: PublishingTarget[] }>(
        `/studio/assets/${id}`, { token }
      ),

    updateAsset: (id: string, body: {
      textContent?: string;
      structuredData?: Record<string, unknown>;
      tags?: string[];
      changeSummary?: string;
    }, token: string) =>
      request<{ asset: ContentAsset; versionCreated: number }>(`/studio/assets/${id}`, {
        method: 'PUT', body: JSON.stringify(body), token,
      }),

    transform: (id: string, body: {
      transformType: 'rewrite' | 'expand' | 'shorten' | 'tone' | 'translate' | 'seo' | 'aso';
      targetTone?: 'professional' | 'casual' | 'urgent' | 'friendly' | 'authoritative';
      targetLanguage?: string;
      targetLength?: number;
      instructions?: string;
    }, token: string) =>
      request<{ asset: Pick<ContentAsset, 'id' | 'text_content' | 'updated_at'>; transformType: string; versionCreated: number }>(
        `/studio/assets/${id}/transform`, { method: 'POST', body: JSON.stringify(body), token }
      ),

    archive: (id: string, token: string) =>
      request<{ id: string; archivedAt: string }>(`/studio/assets/${id}/archive`, { method: 'POST', body: '{}', token }),

    restore: (id: string, token: string) =>
      request<{ id: string; restored: boolean }>(`/studio/assets/${id}/restore`, { method: 'POST', body: '{}', token }),

    publish: (id: string, body: {
      channel: 'meta' | 'google' | 'whatsapp' | 'email' | 'linkedin' | 'web' | 'app_store' | 'play_store';
      platformUrl?: string;
      externalId?: string;
      metadata?: Record<string, unknown>;
    }, token: string) =>
      request<{ publishTarget: PublishingTarget }>(`/studio/assets/${id}/publish`, {
        method: 'POST', body: JSON.stringify(body), token,
      }),

    versions: (id: string, token: string) =>
      request<{ versions: ContentVersion[] }>(`/studio/assets/${id}/versions`, { token }),

    stats: (token: string) =>
      request<StudioStats>('/studio/stats', { token }),
  },

  analytics: {
    summary: (token: string) =>
      request<AnalyticsSummary>('/analytics/summary', { token }),

    kpi: (productId: string, token: string, weeks?: number) => {
      const qs = new URLSearchParams({ productId });
      if (weeks) qs.set('weeks', String(weeks));
      return request<{ productId: string; weeks: KPIPoint[] }>(`/analytics/kpi?${qs}`, { token });
    },

    attribution: (productId: string, token: string) =>
      request<AttributionResult>(`/analytics/attribution?${new URLSearchParams({ productId })}`, { token }),

    funnel: (productId: string, token: string) =>
      request<FunnelResult>(`/analytics/funnel?${new URLSearchParams({ productId })}`, { token }),

    roi: (productId: string, token: string) =>
      request<ROIResult>(`/analytics/roi?${new URLSearchParams({ productId })}`, { token }),

    optimize: (productId: string, token: string) =>
      request<{ created: number; skipped: number }>('/analytics/optimize', {
        method: 'POST', body: JSON.stringify({ productId }), token,
      }),

    insights: (productId: string, token: string) =>
      request<{ insights: OptimizationInsight[] }>(`/analytics/insights?${new URLSearchParams({ productId })}`, { token }),

    updateInsight: (id: string, status: 'applied' | 'dismissed', token: string, actionTaken?: string) =>
      request<{ updated: boolean }>(`/analytics/insights/${id}`, {
        method: 'PATCH', body: JSON.stringify({ status, actionTaken }), token,
      }),
  },

  reports: {
    list: (token: string, params?: { productId?: string; reportType?: string; limit?: number }) => {
      const qs = new URLSearchParams();
      if (params?.productId)  qs.set('productId', params.productId);
      if (params?.reportType) qs.set('reportType', params.reportType);
      if (params?.limit)      qs.set('limit', String(params.limit));
      return request<{ reports: Report[] }>(`/reports?${qs}`, { token });
    },

    generate: (body: {
      productId: string;
      reportType: ReportType;
      periodStart: string;
      periodEnd: string;
      force?: boolean;
      contextData?: Record<string, unknown>;
    }, token: string) =>
      request<{ reportId: string; created: boolean; content: ReportContent; tokensConsumed: number }>('/reports/generate', {
        method: 'POST', body: JSON.stringify(body), token,
      }),

    get: (id: string, token: string) =>
      request<Report>(`/reports/${id}`, { token }),

    exportReport: (id: string, token: string) =>
      request<ReportExport>(`/reports/${id}/export`, { token }),

    feedback: (id: string, rating: number, token: string, comment?: string) =>
      request<{ recorded: boolean }>(`/reports/${id}/feedback`, {
        method: 'POST', body: JSON.stringify({ rating, comment }), token,
      }),
  },

  onboarding: {
    /** Returns the active session (creates one if none exists). */
    getSession: (token: string) =>
      requestData<{ session: OnboardingSession; nextRoute: string }>('/onboarding/session', { token }),

    getSessionById: (sessionId: string, token: string) =>
      requestData<{ session: OnboardingSession; nextRoute: string }>(`/onboarding/sessions/${sessionId}`, { token }),

    saveWorkspace: (sessionId: string, workspaceName: string, token: string) =>
      requestData<{ session: OnboardingSession; nextRoute: string }>(`/onboarding/sessions/${sessionId}/workspace`, {
        method: 'POST', body: JSON.stringify({ workspaceName }), token,
      }),

    startDiscovery: (sessionId: string, urls: string[], token: string, privateDescription?: string) =>
      requestData<{ job: OnboardingDiscoveryJob }>(`/onboarding/sessions/${sessionId}/discovery`, {
        method: 'POST', body: JSON.stringify({ urls, privateDescription }), token,
      }),

    getDiscovery: (sessionId: string, token: string) =>
      requestData<{ job: OnboardingDiscoveryJob; sessionState: string }>(`/onboarding/sessions/${sessionId}/discovery`, { token }),

    retryDiscovery: (sessionId: string, token: string) =>
      requestData<{ job: OnboardingDiscoveryJob }>(`/onboarding/sessions/${sessionId}/discovery/retry`, {
        method: 'POST', body: '{}', token,
      }),

    selectMatch: (sessionId: string, matchId: string, token: string) =>
      requestData<{ job: OnboardingDiscoveryJob }>(`/onboarding/sessions/${sessionId}/discovery/select`, {
        method: 'POST', body: JSON.stringify({ matchId }), token,
      }),

    getReport: (sessionId: string, token: string) =>
      requestData<{ report: PreliminaryReport | null; acknowledged: boolean }>(`/onboarding/sessions/${sessionId}/report`, { token }),

    acknowledgeReport: (sessionId: string, token: string, rating?: 'useful' | 'partly_useful' | 'not_useful', feedback?: string) =>
      requestData<{ acknowledged: boolean }>(`/onboarding/sessions/${sessionId}/report/acknowledge`, {
        method: 'POST', body: JSON.stringify({ acknowledged: true, rating, feedback }), token,
      }),

    getClaims: (sessionId: string, token: string) =>
      requestData<{ claims: ProductClaim[] }>(`/onboarding/sessions/${sessionId}/claims`, { token }),

    reviewClaim: (
      sessionId: string,
      claimId: string,
      data: { status: 'CONFIRMED' | 'CORRECTED' | 'REJECTED'; correctedValue?: string; founderNote?: string },
      token: string,
    ) =>
      requestData<{ claim: ProductClaim }>(`/onboarding/sessions/${sessionId}/claims/${claimId}`, {
        method: 'PATCH', body: JSON.stringify(data), token,
      }),

    regenerateClaims: (sessionId: string, token: string) =>
      requestData<{ regenerated: number }>(`/onboarding/sessions/${sessionId}/claims/regenerate`, {
        method: 'POST', token, body: '{}',
      }),
    completeBeliefReview: (sessionId: string, token: string) =>
      requestData<{ nextState: string }>(`/onboarding/sessions/${sessionId}/claims/complete`, {
        method: 'POST', body: '{}', token,
      }),

    saveAudience: (sessionId: string, data: Record<string, unknown>, token: string) =>
      requestData<{ saved: boolean; nextState: string }>(`/onboarding/sessions/${sessionId}/audience`, {
        method: 'PUT', body: JSON.stringify(data), token,
      }),

    saveContextDelta: (sessionId: string, data: Record<string, unknown>, token: string) =>
      requestData<{ saved: boolean; nextState: string }>(`/onboarding/sessions/${sessionId}/context-delta`, {
        method: 'PUT', body: JSON.stringify(data), token,
      }),

    saveGoal: (sessionId: string, data: Record<string, unknown>, token: string) =>
      requestData<{ saved: boolean; nextState: string }>(`/onboarding/sessions/${sessionId}/goal`, {
        method: 'PUT', body: JSON.stringify(data), token,
      }),

    saveCompetitors: (sessionId: string, data: { competitors: Array<{ id: string; name: string; storeUrl?: string; relationship: string; keyDifferentiator?: string; discoveredBy: string }> }, token: string) =>
      requestData<{ saved: boolean; nextState: string }>(`/onboarding/sessions/${sessionId}/competitors`, {
        method: 'PUT', body: JSON.stringify(data), token,
      }),

    saveBoundaries: (sessionId: string, data: Record<string, unknown>, token: string) =>
      requestData<{ saved: boolean; nextState: string }>(`/onboarding/sessions/${sessionId}/boundaries`, {
        method: 'PUT', body: JSON.stringify(data), token,
      }),

    generateDirection: (sessionId: string, token: string) =>
      requestData<{ direction: OnboardingStrategyDirection }>(`/onboarding/sessions/${sessionId}/direction`, {
        method: 'POST', body: '{}', token,
      }),

    getDirection: (sessionId: string, token: string) =>
      requestData<{ direction: OnboardingStrategyDirection | null }>(`/onboarding/sessions/${sessionId}/direction`, { token }),

    completePhase1: (sessionId: string, data: { directionId: string; acknowledgedDirection: true }, token: string) =>
      requestData<{ session: OnboardingSession; nextRoute: string }>(`/onboarding/sessions/${sessionId}/complete`, {
        method: 'POST', body: JSON.stringify(data), token,
      }),
  },

  intelligence: {
    // workspaceId is optional context; the server resolves the caller's own
    // workspace when it is omitted and rejects one they are not a member of.
    coverage: (token: string, workspaceId?: string) =>
      requestData<GrowthBrainCoverage>('/intelligence/coverage', { token, workspaceId }),

    /**
     * Full learning history behind "View learning log →".
     * @param before - ISO cursor from the previous page's `nextCursor`
     */
    learningLog: (
      token: string,
      opts: { limit?: number; before?: string; productId?: string; workspaceId?: string } = {},
    ) => {
      const qs = new URLSearchParams();
      if (opts.limit)     qs.set('limit', String(opts.limit));
      if (opts.before)    qs.set('before', opts.before);
      if (opts.productId) qs.set('productId', opts.productId);
      const suffix = qs.toString() ? `?${qs.toString()}` : '';
      return requestData<{ entries: LearningLogEntry[]; nextCursor: string | null }>(
        `/intelligence/learning-log${suffix}`,
        { token, workspaceId: opts.workspaceId },
      );
    },
  },

  // Every /connections route replies with the ok() envelope, so these use
  // requestData<T> to unwrap `data`. Using request<T> here silently yields
  // `{ ok, data }` where the caller expects the payload.
  connections: {
    /** Providers that can actually be connected right now (a real adapter exists). */
    providers: (token: string) =>
      requestData<{ available: string[] }>('/connections/providers', { token }),
    list: (token: string, workspaceId?: string) =>
      requestData<WorkspaceConnection[]>('/connections', { token, workspaceId }),
    get: (id: string, token: string) =>
      requestData<WorkspaceConnection>(`/connections/${id}`, { token }),
    /** Records interest in a source. Grants no access and stores no credential. */
    preview: (provider: string, token: string) =>
      requestData<{ connection: WorkspaceConnection; adapterAvailable: boolean }>(
        `/connections/${provider}/preview`,
        { method: 'POST', body: '{}', token },
      ),
    connect: (provider: string, body: Record<string, string>, token: string) =>
      requestData<ConnectResult>(`/connections/${provider}/connect`, {
        method: 'POST',
        body: JSON.stringify(body),
        token,
      }),
    listAccounts: (id: string, token: string) =>
      requestData<ProviderAccount[]>(`/connections/${id}/accounts`, { token }),
    selectResource: (id: string, resourceId: string, resourceName: string, token: string) =>
      requestData<WorkspaceConnection>(`/connections/${id}/select-resource`, {
        method: 'POST',
        body: JSON.stringify({ resourceId, resourceName }),
        token,
      }),
    /** Queues a sync; returns immediately. Poll syncRuns for progress. */
    sync: (id: string, token: string) =>
      requestData<{ syncRunId: string; status: string; traceId: string }>(
        `/connections/${id}/sync`,
        { method: 'POST', body: '{}', token },
      ),
    refresh: (id: string, token: string) =>
      requestData<{ syncRunId: string; status: string; traceId: string }>(
        `/connections/${id}/refresh`,
        { method: 'POST', body: '{}', token },
      ),
    reauthorize: (id: string, token: string) =>
      requestData<WorkspaceConnection>(`/connections/${id}/reauthorize`, {
        method: 'POST',
        body: '{}',
        token,
      }),
    /** Begins a provider OAuth flow. Returns only the authorization URL. */
    oauthStart: (provider: string, token: string, body: Record<string, unknown> = {}) =>
      requestData<{ authorizationUrl: string; expiresAt: string }>(
        `/connections/${provider}/oauth/start`,
        { method: 'POST', body: JSON.stringify(body), token },
      ),
    /** Current permission grant plus the immutable change history. */
    permissions: (id: string, token: string) =>
      requestData<{
        granted: PermissionLevel[];
        history: ConnectionPermissionHistoryEntry[];
        levels: PermissionLevel[];
        executionLevels: PermissionLevel[];
      }>(`/connections/${id}/permissions`, { token }),
    /** Records a request to widen authority. Grants nothing by itself. */
    requestAuthorityUpgrade: (id: string, levels: PermissionLevel[], reason: string, token: string) =>
      requestData<{
        requested: PermissionLevel[]; current: PermissionLevel[];
        affectsSpend: boolean; approvalStillRequired: boolean;
      }>(`/connections/${id}/permissions/request-upgrade`, {
        method: 'POST', body: JSON.stringify({ levels, reason }), token,
      }),
    /** The only path by which CHANGE / PUBLISH / SPEND can be granted. */
    approveAuthorityUpgrade: (id: string, levels: PermissionLevel[], reason: string, token: string) =>
      requestData<{ granted: PermissionLevel[] }>(
        `/connections/${id}/permissions/approve-upgrade`,
        { method: 'POST', body: JSON.stringify({ levels, reason }), token },
      ),
    /** What this connection could and could not do, per action, with the reason. */
    executionBoundary: (id: string, token: string) =>
      requestData<ExecutionBoundary>(`/connections/${id}/execution-boundary`, { token }),
    /** Records a refusal. Never changes the grant — see the route's own note. */
    denyAuthorityUpgrade: (id: string, levels: PermissionLevel[], reason: string, token: string) =>
      requestData<{ granted: PermissionLevel[] }>(`/connections/${id}/permissions/deny-upgrade`, {
        method: 'POST', body: JSON.stringify({ levels, reason }), token,
      }),

    downgradeAuthority: (id: string, levels: PermissionLevel[], reason: string, token: string) =>
      requestData<{ granted: PermissionLevel[] }>(
        `/connections/${id}/permissions/downgrade`,
        { method: 'POST', body: JSON.stringify({ levels, reason }), token },
      ),
    syncRuns: (id: string, token: string) =>
      requestData<SyncRun[]>(`/connections/${id}/sync-runs`, { token }),
    health: (id: string, token: string) =>
      requestData<ConnectionHealth>(`/connections/${id}/health`, { token }),
    disconnect: (id: string, token: string) =>
      request<void>(`/connections/${id}`, { method: 'DELETE', token }),
  },
};

// ── Types ────────────────────────────────────────────────────────────────────

export interface Product {
  id: string;
  founder_id: string;
  name: string;
  store_url: string;
  platform: 'app_store' | 'play_store';
  category: string | null;
  markets: string[];
  price_tier: string | null;
  confirmed_icp: ICPBrief | null;
  competitor_set: CompetitorApp[] | null;
  scraped_meta: ScrapedMeta | null;
  last_scraped_at: string | null;
  archived_at: string | null;
  archive_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScrapedMeta {
  name: string;
  developer: string;
  description: string;
  category: string;
  rating: number;
  ratingCount: number;
  priceTier: string;
  screenshots: string[];
  reviews: Review[];
  platform?: 'app_store' | 'play_store';
  storeUrl?: string;
}

export interface Review {
  rating: number;
  text: string;
  date: string;
}

export interface CompetitorApp {
  name: string;
  developer: string;
  rating: number;
  category: string;
  priceTier: string;
  platform: 'app_store' | 'play_store' | 'website';
}

export interface ICPBrief {
  targetUser: string;
  geography: string[];
  priceTier: string;
  painPoints: string[];
  competitorGaps: string[];
  suggestedMarkets: string[];
}

export interface ScrapeResult {
  scraped: ScrapedMeta;
  icpBrief: ICPBrief;
  competitors: CompetitorApp[];
}

export interface AsyncScrapeResult {
  productId: string;
  jobId: string;
  status: 'queued';
}

export interface ConfirmProductBody {
  url: string;
  platform: 'app_store' | 'play_store';
  scraped: ScrapedMeta;
  icpBrief: ICPBrief;
  competitors: CompetitorApp[];
}

export interface CheckoutBody {
  plan: 'solo' | 'builder' | 'studio';
  currency: 'usd' | 'inr';
}

export type CheckoutResult =
  | { url: string }
  | { orderId: string; amount: number; currency: string; keyId: string };

export interface SubscriptionStatus {
  plan: string;
  tokenBalance: number | null;
  renewalNote: string;
}

export type SupportedPlatform = 'meta' | 'google' | 'whatsapp' | 'linkedin' | 'email';

export interface ConnectedChannel {
  platform: string;
  scopes: string[];
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface WeeklySummary {
  weekOf: string;
  totalImpressions: number;
  totalClicks: number;
  totalInstalls: number;
  avgCpi: number | null;
  avgRoas: number | null;
  avgCtr: number | null;
}

export interface ChannelBreakdown {
  channel: string;
  market: string;
  impressions: number;
  clicks: number;
  installs: number;
  avgRoas: number | null;
  campaignCount: number;
}

export interface TopPerformer {
  campaignId: string;
  channel: string;
  market: string;
  hookType: string | null;
  weekOf: string;
  installs: number;
  roas: number | null;
  ctr: number | null;
}

export interface ProductMetrics {
  productId: string;
  weeklySummaries: WeeklySummary[];
  channelBreakdown: ChannelBreakdown[];
  topPerformers: TopPerformer[];
  weekCount: number;
}

export interface UTMLink {
  id: string;
  campaignId: string;
  baseUrl: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent: string | null;
  utmTerm: string | null;
  shortCode: string;
  clickCount: number;
  trackedUrl: string;
  shortUrl: string;
  createdAt: string;
}

export interface CreateUTMLinkBody {
  baseUrl: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent?: string;
  utmTerm?: string;
}

export interface Campaign {
  id: string;
  product_id: string;
  productName: string | null;
  channel: string;
  market: string;
  status: 'draft' | 'pending_approval' | 'approved' | 'launched' | 'paused' | 'completed';
  hook_type: string | null;
  copy_text: string | null;
  spend_cap: Record<string, unknown> | null;
  external_campaign_id: string | null;
  ai_tokens_consumed: number;
  approved_at: string | null;
  launched_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WeeklyBrief {
  id: string;
  product_id: string;
  productName: string | null;
  week_of: string;
  what_worked: string | null;
  what_to_kill: string | null;
  next_actions: Record<string, unknown> | null;
  generated_assets: Record<string, unknown> | null;
  ai_tokens_consumed: number;
  status: 'draft' | 'sent' | 'acknowledged';
  sent_at: string | null;
  created_at: string;
}

export interface Workspace {
  id: string;
  founder_id: string;
  name: string;
  client_name: string | null;
  workspace_type?: 'personal' | 'team';
  created_at: string;
}

export interface WorkspaceMember {
  id: string;
  workspace_id: string;
  founder_id: string | null;
  role: 'owner' | 'admin' | 'editor' | 'viewer';
  invited_email: string | null;
  accepted_at: string | null;
}

export interface Integration {
  platform: string;
  integration_type: 'oauth' | 'api_key' | 'service_account' | 'url_only' | null;
  integration_config: Record<string, unknown> | null;
  connected: boolean;
  scopes: string[];
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface Phase2ConnectionStatus {
  connected:   boolean;
  connectedAt: string | null;
  syncStatus:  'pending' | 'synced' | 'error' | null;
}

export interface Phase2Connections {
  app_store_connect: Phase2ConnectionStatus;
  revenue_cat:       Phase2ConnectionStatus;
  google_analytics:  Phase2ConnectionStatus;
  google_ads:        Phase2ConnectionStatus;
  meta_ads:          Phase2ConnectionStatus;
  connectedCount:    number;
}

export type MilestoneState   = 'done' | 'current' | 'pending';
export type StatusSeverity   = 'active' | 'warning' | 'muted';
export type ProductPlatform  = 'app_store' | 'play_store' | 'both';
export type RecommendedSource = 'app_store_connect' | 'revenue_cat' | 'ga4';

export interface RoadmapLevelStatus {
  label:    string;
  severity: StatusSeverity;
  active:   boolean;
}

export interface CapabilityStatus {
  level:            number;
  levelName:        string;
  confidence:       number;
  evidenceLabel:    string;
  completedSteps:   string[];
  nextStep:         string;
  activeGoal:       string | null;
  productPlatform:  ProductPlatform;
  recommendedFirst: RecommendedSource;
  milestoneStates: {
    discovery:    MilestoneState;
    alignment:    MilestoneState;
    intelligence: MilestoneState;
    execution:    MilestoneState;
    autonomy:     MilestoneState;
  };
  roadmapStatuses: {
    level1:  RoadmapLevelStatus;
    level2:  RoadmapLevelStatus;
    level3:  RoadmapLevelStatus;
    level45: RoadmapLevelStatus;
  };
  proofChecks: {
    sourceConnected:  boolean;
    syncComplete:     boolean;
    insightDelivered: boolean;
  };
  connections: Phase2Connections;
}

export interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface Founder {
  id: string;
  email: string;
  name: string | null;
  plan: 'free' | 'solo' | 'builder' | 'studio';
  token_balance: number | null;
  onboarding_step: number;
  active_workspace_id: string | null;
  active_product_id: string | null;
  created_at?: string;
}

export interface FounderInsights {
  topChannel: string | null;
  avgInstallsPerWeek: number;
  bestPerformingProduct: { id: string; name: string | null; installs: number } | null;
  channelBreakdown: Array<{ channel: string; totalInstalls: number; avgCPI: number | null }>;
}

export interface BrandVoicePreview {
  original: string;
  adjusted: string;
  tone: string;
  adjectives: string[];
}

export interface TokenTopupBody {
  packSize: 500 | 1500 | 5000;
  currency: 'usd' | 'inr';
}

export type TokenTopupResult =
  | { url: string }
  | { orderId: string; amount: number; currency: string; keyId: string };

export interface TokenUsageBreakdown {
  action: string;
  count: number;
  totalTokens: number;
}

export interface TokenUsage {
  since: string;
  breakdown: TokenUsageBreakdown[];
  totalConsumed: number;
}

// ── Marketing Memory & Knowledge Graph (Milestone 04) ─────────────────────────

export type MemoryType =
  | 'founder' | 'brand' | 'product' | 'customer' | 'campaign'
  | 'creative' | 'review' | 'competitor' | 'experiment' | 'market' | 'seasonality';

export type MemoryStatus = 'draft' | 'active' | 'archived';

export type MemorySource =
  | 'intake' | 'growth_brain' | 'campaign_performance' | 'review'
  | 'analytics' | 'founder_feedback' | 'ai_conversation' | 'experiment';

export type NodeType =
  | 'product' | 'feature' | 'persona' | 'icp' | 'competitor' | 'campaign'
  | 'creative' | 'channel' | 'review' | 'market' | 'goal' | 'opportunity' | 'risk';

export type EdgeRelationship =
  | 'targets' | 'competes_with' | 'belongs_to' | 'influenced_by'
  | 'validated_by' | 'generated_from' | 'has_feature' | 'serves_persona'
  | 'appears_in' | 'measured_by' | 'leads_to' | 'blocks';

export interface MarketingMemory {
  id: string;
  founder_id: string;
  product_id: string | null;
  memory_type: MemoryType;
  title: string;
  content: Record<string, unknown>;
  source: MemorySource;
  confidence: number;
  evidence_ids: string[];
  status: MemoryStatus;
  version: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface MarketingMemoryVersion {
  id: string;
  memory_id: string;
  version: number;
  content: Record<string, unknown>;
  source: MemorySource;
  confidence: number;
  changed_by: 'ai' | 'founder' | 'system';
  change_note: string | null;
  created_at: string;
}

export interface KnowledgeNode {
  id: string;
  founder_id: string;
  product_id: string | null;
  node_type: NodeType;
  label: string;
  properties: Record<string, unknown>;
  source_id: string | null;
  source_type: string | null;
  confidence: number;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeEdge {
  id: string;
  founder_id: string;
  source_id: string;
  target_id: string;
  relationship: EdgeRelationship;
  weight: number;
  properties: Record<string, unknown>;
  created_at: string;
}

export interface KnowledgeGraph {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
}

export interface LearningEvent {
  id: string;
  founder_id: string;
  product_id: string | null;
  event_type: string;
  payload: Record<string, unknown>;
  memories_created: number;
  memories_updated: number;
  nodes_created: number;
  edges_created: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error: string | null;
  processed_at: string | null;
  created_at: string;
}

export interface LearningEventResult {
  eventId: string;
  memoriesCreated: number;
  memoriesUpdated: number;
  nodesCreated: number;
  edgesCreated: number;
}

// ── AI Platform ───────────────────────────────────────────────────────────────

export interface AIPrompt {
  id: string;
  promptId: string;
  version: number;
  purpose: string;
  owner: string;
  model: 'sonnet' | 'haiku';
  systemTemplate: string | null;
  userTemplate: string;
  status: 'draft' | 'active' | 'archived';
  tokenCost: number;
  createdAt: string;
}

export interface AIRequest {
  id: string;
  prompt_id: string;
  prompt_version: number;
  model: string;
  action: string;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  cost_usd: number | null;
  latency_ms: number | null;
  retries: number;
  status: 'success' | 'failed' | 'retried' | 'timeout';
  error: string | null;
  context_sources: string[];
  created_at: string;
}

export interface AIAuditStats {
  totals: {
    requests: number;
    totalTokens: number;
    totalCostUsd: number;
    failures: number;
  };
  byModel: Record<string, {
    requests: number;
    totalTokens: number;
    totalCostUsd: number;
    avgLatencyMs: number;
  }>;
  byPrompt: Record<string, {
    requests: number;
    failures: number;
  }>;
}

export interface AIContextPackage {
  founderId: string;
  productId: string | null;
  assembledAt: string;
  sources: string[];
  founder: { plan: string; tokenBalance: number | null };
  product: {
    name: string;
    platform: string;
    markets: string[];
    category: string | null;
  } | null;
  memories: Array<{ type: string; title: string; confidence: number }>;
  knowledgeNodes: Array<{ type: string; label: string; confidence: number }>;
  campaigns: Array<{ channel: string; market: string; status: string }>;
  analytics: {
    totalInstalls: number;
    avgCtr: number | null;
    avgCpi: number | null;
    topChannel: string | null;
  } | null;
  budget: {
    plan: string;
    tokenBalance: number | null;
    estimatedMonthlyUSD: number | null;
  };
}

// ── Agent Platform / Missions ─────────────────────────────────────────────────

export type MissionStatus = 'draft' | 'queued' | 'running' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled';
export type MissionType   = 'research' | 'strategy' | 'planning' | 'content' | 'creative' | 'campaign' | 'publishing' | 'optimization' | 'learning' | 'reporting' | 'memory' | 'benchmark';
export type StepStatus    = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'waiting_approval';

export interface Mission {
  id:                 string;
  founder_id:         string;
  product_id:         string | null;
  workspace_id:       string | null;
  type:               MissionType;
  title:              string;
  status:             MissionStatus;
  priority:           number;
  trigger_type:       string;
  input:              Record<string, unknown> | null;
  output:             Record<string, unknown> | null;
  error:              string | null;
  idempotency_key:    string | null;
  scheduled_at:       string | null;
  started_at:         string | null;
  completed_at:       string | null;
  failed_at:          string | null;
  cancelled_at:       string | null;
  retry_count:        number;
  max_retries:        number;
  ai_tokens_consumed: number;
  created_at:         string;
  updated_at:         string;
}

export interface MissionStep {
  id:                string;
  mission_id:        string;
  founder_id:        string;
  step_order:        number;
  step_name:         string;
  agent_type:        string;
  status:            StepStatus;
  requires_approval: boolean;
  input:             Record<string, unknown> | null;
  output:            Record<string, unknown> | null;
  error:             string | null;
  retry_count:       number;
  max_retries:       number;
  ai_request_id:     string | null;
  started_at:        string | null;
  completed_at:      string | null;
  created_at:        string;
}

export interface MissionLog {
  id:         string;
  mission_id: string;
  founder_id: string;
  step_id:    string | null;
  level:      'debug' | 'info' | 'warn' | 'error';
  message:    string;
  metadata:   Record<string, unknown> | null;
  created_at: string;
}

export interface MissionApproval {
  id:            string;
  mission_id:    string;
  step_id:       string;
  founder_id:    string;
  status:        'pending' | 'approved' | 'rejected';
  title:         string;
  description:   string | null;
  preview_data:  Record<string, unknown> | null;
  requested_at:  string;
  responded_at:  string | null;
  response_note: string | null;
}

// ── Owner Experience ──────────────────────────────────────────────────────────

export interface Opportunity {
  id:              string;
  founder_id:      string;
  product_id:      string | null;
  type:            string;
  title:           string;
  description:     string | null;
  expected_impact: string | null;
  confidence:      number | null;
  effort:          'low' | 'medium' | 'high';
  risk:            'low' | 'medium' | 'high';
  why_now:         string | null;
  source:          string | null;
  evidence:        unknown;           // jsonb — always pass through toStringArray()
  state:           'active' | 'saved' | 'dismissed' | 'converted';
  mission_id:      string | null;
  created_at:      string;
  updated_at:      string;
}

export interface Notification {
  id:           string;
  founder_id:   string;
  type:         'approval_needed' | 'mission_completed' | 'growth_brain_updated' | 'campaign_issue' | 'integration_issue' | 'billing_issue' | 'security_issue' | 'weekly_summary_ready' | 'experiment_result';
  title:        string;
  message:      string | null;
  action_url:   string | null;
  action_label: string | null;
  resource_type: string | null;
  resource_id:  string | null;
  is_read:      boolean;
  created_at:   string;
}

export interface AskResponse {
  summary:               string;
  recommendedAction:     string;
  suggestedMissionType:  string | null;
  suggestedMissionTitle: string | null;
  expectedImpact:        string;
  confidence:            number;
  risks:                 string[];
  nextStep:              string;
  evidence:              string[];
}

export interface BriefResponse {
  founder:     { name: string; plan: string };
  product:     { id: string; name: string; platform: string } | null;
  recommendation: {
    title:      string;
    summary:    string;
    whyNow:     string;
    confidence: number;
    evidence:   string[];
    action:     string;
    missionType: string | null;
  } | null;
  pendingApprovals: {
    total: number;
    items: Array<{ id: string; type: 'campaign' | 'mission'; title: string; preview: string | null; missionId: string | null }>;
  };
  opportunities: Opportunity[];
  recentTimeline: TimelineEvent[];
  growthBrain: { hasStrategy: boolean; confidence: number | null; lastUpdated: string | null };
  metrics: { weeklyInstalls: number | null; cpi: number | null; activeCampaigns: number; weekOverWeekInstallDelta: number | null };
  memories: Array<{ id: string; title: string; body: string | null; memoryType: string; confidence: number }>;
  phase1: {
    direction: {
      headline: string;
      rationale: string;
      primaryChannel: string | null;
      week1: unknown;
      week2: unknown;
      week3: unknown;
      week4: unknown;
    } | null;
    audience:    string | null;
    contextDelta: string | null;
    workingStyle: string | null;
    primaryGoal: { type: string; target: number; unit: string; horizonDays: number } | null;
  } | null;
}

export interface TimelineEvent {
  id:       string;
  type:     string;
  title:    string;
  subtitle?: string;
  time:     string;
  link?:    string;
  level?:   string;
}

export interface ResultsSummary {
  summary: {
    totalInstalls:     number;
    avgCpi:            number | null;
    activeCampaigns:   number;
    completedMissions: number;
  };
  weeklyData: Array<{
    week:        string;
    installs:    number;
    clicks:      number;
    impressions: number;
    avgCpi:      number | null;
    avgRoas:     number | null;
  }>;
  channels:        Array<{ channel: string; installs: number; campaigns: number }>;
  recentCampaigns: Array<{ id: string; channel: string; market: string; status: string; hook_type: string | null; launched_at: string | null }>;
  recentMissions:  Array<{ id: string; type: string; title: string; status: string; output: Record<string, unknown> | null; completed_at: string | null }>;
}

// ── Content Studio types ──────────────────────────────────────────────────────
// ContentAsset is imported and re-exported from lib/types/content at the top of this file.

export interface ContentVersion {
  id:                   string;
  asset_id:             string;
  version_number:       number;
  text_content:         string | null;
  structured_data:      Record<string, unknown> | null;
  media_url:            string | null;
  prompt_version:       number | null;
  growth_brain_version: number | null;
  change_type:          'editor_save' | 'ai_regen' | 'ai_transform' | 'bulk_approve';
  change_summary:       string | null;
  changed_by:           string;
  created_at:           string;
}

export interface PublishingTarget {
  id:           string;
  asset_id:     string;
  founder_id:   string;
  channel:      string;
  platform_url: string | null;
  external_id:  string | null;
  published_by: string;
  published_at: string;
  status:       'scheduled' | 'live' | 'removed' | 'error';
  error_message: string | null;
  metadata:     Record<string, unknown> | null;
  created_at:   string;
}

export interface AssetApproval {
  id:             string;
  asset_id:       string;
  founder_id:     string;
  action:         'approved' | 'rejected' | 'held' | 'restored';
  note:           string | null;
  version_number: number | null;
  approved_at:    string;
  created_at:     string;
}

export interface StudioStats {
  totalAssets:    number;
  archivedAssets: number;
  totalVersions:  number;
  publishedCount: number;
  totalTokens:    number;
  byType:         Record<string, number>;
  byStatus:       Record<string, number>;
}

// ── Campaigns M09 extended types ─────────────────────────────────────────────

export type CampaignStatus =
  | 'draft' | 'pending_approval' | 'approved' | 'launched' | 'paused' | 'completed'
  | 'scheduled' | 'publishing' | 'failed' | 'cancelled' | 'archived';

export interface CampaignDetail extends Omit<Campaign, 'status'> {
  type: string | null;
  mission_id: string | null;
  growth_brain_version: number;
  scheduled_at: string | null;
  cancelled_at: string | null;
  archived_at: string | null;
  failed_at: string | null;
  failure_reason: string | null;
  status: CampaignStatus;
  audience_config: Record<string, unknown> | null;
}

export interface CampaignMetric {
  id: string;
  campaign_id: string;
  week_start: string;
  impressions: number;
  clicks: number;
  installs: number;
  cpi: number | null;
  ctr: number | null;
  roas: number | null;
  top_performing_asset: string | null;
  collected_at: string;
}

export interface CampaignApproval {
  id: string;
  campaign_id: string;
  founder_id: string;
  action: 'approved' | 'rejected' | 'budget_adjusted' | 'auto_approved' | 'revoked';
  note: string | null;
  scope: string | null;
  budget_amount: number | null;
  channel: string | null;
  risk_level: string | null;
  approved_at: string;
  created_at: string;
}

export interface PublishAttempt {
  id: string;
  campaign_id: string;
  channel: string;
  attempt_number: number;
  status: 'pending' | 'success' | 'failed' | 'retrying' | 'skipped';
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

// ── Experiments ───────────────────────────────────────────────────────────────

export type ExperimentStatus =
  | 'draft' | 'ready' | 'running' | 'waiting_for_data'
  | 'completed' | 'inconclusive' | 'failed' | 'archived';

export interface Experiment {
  id:               string;
  product_id:       string;
  founder_id:       string;
  campaign_id:      string | null;
  mission_id:       string | null;
  title:            string;
  hypothesis:       string;
  experiment_type:  'copy' | 'creative' | 'channel' | 'aso' | 'audience';
  goal:             string;
  metric:           string;
  status:           ExperimentStatus;
  market:           string | null;
  start_date:       string | null;
  end_date:         string | null;
  expected_outcome: string | null;
  confidence:       number | null;
  winner:           'a' | 'b' | 'inconclusive' | null;
  winner_confidence: number | null;
  learning:         string | null;
  learning_summary: string | null;
  growth_brain_version: number;
  memory_id:        string | null;
  archived_at:      string | null;
  created_at:       string;
  updated_at:       string;
}

export interface ExperimentVariant {
  id:            string;
  experiment_id: string;
  founder_id:    string;
  variant:       'a' | 'b';
  asset_id:      string | null;
  label:         string;
  description:   string | null;
  config:        Record<string, unknown> | null;
  impressions:   number;
  clicks:        number;
  conversions:   number;
  metric_value:  number | null;
}

// ── Execution Calendar ────────────────────────────────────────────────────────

export type CalendarEventType =
  | 'campaign_launch' | 'experiment_window' | 'content_publish' | 'aso_update'
  | 'review_push' | 'brief_sent' | 'product_launch' | 'holiday_campaign' | 'custom';

export type CalendarEventSource = 'authored' | 'campaign' | 'experiment' | 'brief';

export interface CalendarEvent {
  id:           string;
  source:       CalendarEventSource;
  type:         CalendarEventType;
  title:        string;
  description?: string | null;
  startDate:    string;
  endDate?:     string | null;
  allDay:       boolean;
  status:       'scheduled' | 'completed' | 'missed' | 'cancelled';
  campaignId?:  string | null;
  experimentId?: string | null;
  briefId?:     string | null;
  metadata?:    Record<string, unknown> | null;
}

// ── M10: Intelligence Network & Recommendation Engine ────────────────────────

export type RecommendationType =
  | 'opportunity' | 'warning' | 'optimization' | 'budget'
  | 'expansion' | 'competitive_response' | 'content_recommendation' | 'campaign_recommendation';

export type RecommendationFeedbackType =
  | 'helpful' | 'not_helpful' | 'wrong' | 'too_early' | 'already_doing';

export interface SourceSignal {
  type:  'campaign_metric' | 'experiment' | 'marketing_memory' | 'benchmark' | 'review' | 'knowledge_graph';
  id:    string;
  label: string;
}

export interface Recommendation {
  id:                  string;
  product_id:          string | null;
  type:                string;
  recommendation_type: RecommendationType | null;
  title:               string;
  description:         string | null;
  expected_impact:     string | null;
  confidence:          number | null;
  effort:              'low' | 'medium' | 'high';
  risk:                'low' | 'medium' | 'high';
  why_now:             string | null;
  source:              string | null;
  evidence:            string[] | null;
  score:               number | null;
  priority:            number | null;
  source_signals:      SourceSignal[] | null;
  expires_at:          string | null;
  state:               'active' | 'saved' | 'dismissed' | 'converted';
  mission_id:          string | null;
  feedback_summary:    { helpful: number; not_helpful: number; other: number; last_feedback?: string } | null;
  created_at:          string;
  updated_at:          string;
}

export interface BenchmarkResult {
  category:              string;
  market:                string;
  channel:               string | null;
  avgInstallDeltaPct:    number;
  medianInstallDeltaPct: number;
  avgConversionRate:     number;
  avgRetentionD7:        number;
  topChannel:            string | null;
  signalCount:           number;
  period:                string;
}

export interface TrendSummary {
  category:   string;
  market:     string;
  channel:    string | null;
  trendType:  string;
  direction:  'up' | 'down' | 'flat' | 'volatile';
  magnitude:  number;
  periodDays: number;
  summary:    string;
  computedAt: string;
}

export interface BenchmarkSummary {
  productName: string;
  category:    string;
  market:      string;
  benchmark:   BenchmarkResult | null;
  trends:      TrendSummary[];
}

// ── M11: Analytics, Reporting & Optimization types ──────────────────────────

export type ReportType = 'weekly' | 'monthly' | 'executive' | 'campaign' | 'experiment';

export interface KPIPoint {
  weekOf:      string;
  impressions: number;
  clicks:      number;
  installs:    number;
  cpi:         number | null;
  roas:        number | null;
  ctr:         number | null;
}

export interface KPISummary {
  totalImpressions:         number;
  totalClicks:              number;
  totalInstalls:            number;
  avgCpi:                   number | null;
  avgRoas:                  number | null;
  avgCtr:                   number | null;
  weekOverWeekInstallDelta: number | null;
  topChannel:               string | null;
  topMarket:                string | null;
}

export interface AnalyticsSummary {
  founderId:   string;
  products:    Array<{ productId: string; productName: string; kpi: KPISummary }>;
  totals:      KPISummary;
  generatedAt: string;
}

export interface AttributionResult {
  totalInstalls: number;
  byChannel: Array<{
    channel:  string;
    market:   string;
    installs: number;
    share:    number;
    avgCpi:   number | null;
    avgRoas:  number | null;
  }>;
  topChannel: string | null;
  topMarket:  string | null;
}

export interface FunnelResult {
  impressions:           number;
  clicks:                number;
  installs:              number;
  impressionToClickRate: number | null;
  clickToInstallRate:    number | null;
  overallFunnelRate:     number | null;
  byChannel: Array<{
    channel:        string;
    market:         string;
    impressions:    number;
    clicks:         number;
    installs:       number;
    ctr:            number | null;
    conversionRate: number | null;
  }>;
}

export interface ROIResult {
  estimatedSpend:   number;
  estimatedRevenue: number;
  overallROI:       number | null;
  byChannel: Array<{
    channel:          string;
    market:           string;
    estimatedSpend:   number;
    estimatedRevenue: number;
    roas:             number | null;
    roi:              number | null;
  }>;
}

export interface OptimizationInsight {
  id?:            string;
  insightType:    string;
  title:          string;
  description:    string;
  impactEstimate?: string;
  confidence:     number;
  sourceMetrics?: Record<string, unknown>;
  status?:        string;
  createdAt?:     string;
}

export interface ReportContent {
  headline:    string;
  summary:     string;
  whatWorked:  string[];
  whatToFix:   string[];
  keyInsights: string[];
  nextActions: string[];
  riskFlags?:  string[];
}

export interface Report {
  id:               string;
  product_id:       string;
  report_type:      ReportType;
  period_start:     string;
  period_end:       string;
  title:            string;
  summary:          string | null;
  content:          ReportContent;
  metrics_snapshot: Record<string, unknown> | null;
  ai_tokens_consumed: number;
  export_count:     number;
  status:           'draft' | 'ready' | 'exported';
  created_at:       string;
  updated_at:       string;
}

export interface ReportExport {
  exportedAt:      string;
  reportId:        string;
  productId:       string;
  reportType:      ReportType;
  period:          { start: string; end: string };
  title:           string;
  summary:         string | null;
  content:         ReportContent;
  metricsSnapshot: Record<string, unknown> | null;
  generatedAt:     string;
}

// ── Phase 1 Onboarding Types ──────────────────────────────────────────────

export type OnboardingState =
  | 'WORKSPACE_SETUP' | 'DISCOVERY_PENDING' | 'DISCOVERY_IN_PROGRESS'
  | 'DISCOVERY_MATCH_NEEDED' | 'DISCOVERY_FAILED' | 'PRELIMINARY_REPORT'
  | 'BELIEF_REVIEW' | 'ALIGNMENT_AUDIENCE' | 'ALIGNMENT_CONTEXT'
  | 'ALIGNMENT_GOAL' | 'ALIGNMENT_COMPETITORS' | 'BOUNDARIES_SETUP'
  | 'FINAL_REVIEW' | 'DIRECTION_GENERATING' | 'DIRECTION_COMPLETE'
  | 'PHASE_1_COMPLETE';

export interface OnboardingSession {
  id:                  string;
  founder_id:          string;
  workspace_id:        string | null;
  product_id:          string | null;
  current_state:       OnboardingState;
  lock_version:        number;
  step_completed:      number;
  workspace_name:      string | null;
  urls_submitted:      string[] | null;
  private_description: string | null;
  completed_at:        string | null;
  created_at:          string;
  updated_at:          string;
  // Rich joined fields returned by getSessionById
  founder_context?: {
    audience_confirmed:  string | null;
    audience_additions:  string | null;
    context_delta:       string | null;
    hidden_strengths:    string | null;
    recent_wins:         string | null;
    working_style:       string | null;
  } | null;
  business_goal?: {
    goal_type:           string;
    custom_metric:       string | null;
    baseline_value:      number | null;
    target_value:        number;
    unit:                string | null;
    time_horizon_days:   number;
    motivation:          string | null;
  } | null;
  approval_boundary?: {
    working_style:           string | null;
    weekly_spend_cap_usd:    number | null;
    founder_acknowledged:    boolean;
  } | null;
  competitor_set?: CompetitorRelationshipDB[] | null;
}

export interface CandidateMatch {
  id:           string;
  name:         string;
  url:          string;
  icon:         string | null;
  rating:       number | null;
  review_count: number | null;
  description:  string | null;
}

export interface PreliminaryReport {
  headline:      string;
  summary:       string;
  topInsights:   string[];
  opportunities: Array<{ title: string; description: string; confidence: number }>;
  risks:         Array<{ title: string; description: string }>;
}

export interface OnboardingDiscoveryJob {
  id:                  string;
  session_id:          string;
  founder_id:          string;
  status:              'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress:            number;
  progress_stage:      number;
  progress_message:    string | null;
  urls_submitted:      string[];
  detected_platform:   string | null;
  store_url:           string | null;
  candidate_matches:   CandidateMatch[] | null;
  report_data:         PreliminaryReport | null;
  report_acknowledged: boolean;
  error_code:          string | null;
  error_message:       string | null;
  retry_count:         number;
  max_retries:         number;
  app_metadata:        Record<string, unknown> | null;
  competitor_data:     { competitors?: Array<{ name: string; websiteUrl?: string; relationship: string; discoveredBy: 'AI' }> } | null;
  created_at:          string;
  updated_at:          string;
}

export interface ProductClaim {
  id:               string;
  session_id:       string;
  claim_type:       'FACT' | 'INFERENCE' | 'FOUNDER_PROVIDED';
  category:         string;
  title:            string;
  body:             string;
  confidence:       number;
  evidence_sources: Array<{ type: string; count: number; excerpt: string }>;
  status:           'UNREVIEWED' | 'CONFIRMED' | 'CORRECTED' | 'REJECTED';
  original_value:   string | null;
  corrected_value:  string | null;
  founder_note:     string | null;
  display_order:    number;
  created_at:       string;
  updated_at:       string;
}

export interface WeekPlan {
  focus:           string;
  tasks?:          string[];
  actions?:        string[];        // alias for tasks in direction response
  expectedOutcome?: string;
  success_metric?:  string;         // alias for expectedOutcome
}

export interface OnboardingStrategyDirection {
  id:                  string;
  session_id:          string;
  headline:            string;
  rationale:           string;
  primary_channel:     string | null;
  primary_market:      string | null;
  week_1:              WeekPlan | null;
  week_2:              WeekPlan | null;
  week_3:              WeekPlan | null;
  week_4:              WeekPlan | null;
  key_assumptions:     string[] | null;
  risk_flags:          string[] | null;
  acknowledged_at:     string | null;
  ai_tokens_consumed:  number;
  status:              'draft' | 'generating' | 'ready' | 'acknowledged';
  created_at:          string;
  updated_at:          string;
  // Extended optional fields (populated when backend provides richer output)
  primary_objective?:  string;
  biggest_constraint?: string;
  first_mission?:      string;
  immediate_action?:   string;
  success_signal?:     string;
  confidence_level?:   number;  // 0–100
  evidence_used?:      string[];
  missing_data?:       string[];
}

// CompetitorRelationshipDB: DB-shaped record returned from the API
export interface CompetitorRelationshipDB {
  id:                 string;
  name:               string;
  store_url:          string | null;
  website_url:        string | null;
  platform:           string | null;
  relationship:       'CONFIRMED' | 'REJECTED' | 'MANUALLY_ADDED';
  key_differentiator: string | null;
  discovered_by:      'AI' | 'FOUNDER';
}

// CompetitorRelationship: camelCase payload sent to the API (save/create)
export interface CompetitorRelationship extends CompetitorRelationshipDB {
  storeUrl?:         string;
  keyDifferentiator?: string;
  discoveredBy?:     'AI' | 'FOUNDER';
}

// ── Intelligence / Improve Intelligence types ─────────────────────────────────

export interface IntelligenceDimension {
  label:       string;
  description: string;
  score:       number;
  missing:     boolean;
  provider:    string | null;
  /** Owner-facing state, e.g. "Not connected", "Connected, no history yet". */
  statusLabel: string;
  /** True when the score reflects data genuinely imported from a provider. */
  observed:    boolean;
}

/**
 * Canonical per-provider connection state. This — not the presence of a token —
 * is what every surface must use to decide whether a source is connected.
 */
export interface CanonicalConnectionState {
  provider:         string;
  status:           WorkspaceConnection['status'];
  healthy:          boolean;
  inFlight:         boolean;
  needsAttention:   boolean;
  noHistory:        boolean;
  lastSyncedAt:     string | null;
  /** Derived from the age of the last sync, not a column written once at sync time. */
  freshness:        FreshnessLevel;
  /** Owner-facing wording for `freshness`. Render this, never the raw level. */
  freshnessLabel:   string;
  signalCount:      number;
  /** False when no real integration exists yet — do not offer a live connect. */
  adapterAvailable: boolean;
  errorDetail:      string | null;
}

/** One entry in the Growth Brain learning log (spec §4.3). */
export interface LearningLogEntry {
  id:            string;
  createdAt:     string;
  eventType:
    | 'source_connected'
    | 'source_synced'
    | 'source_disconnected'
    | 'source_reauthorized'
    | 'context_updated'
    | 'context_delta_updated'
    | 'recommendation_updated'
    | 'authority_changed';
  /** Owner-facing description of what caused the change. */
  trigger:       string;
  provider:      string | null;
  providerLabel: string | null;
  connectionId:  string | null;
  syncRunId:     string | null;
  traceId:       string | null;
  evidence:      Array<{ label: string; value: string | number }>;
  previousState: string | null;
  newState:      string | null;
  priorConfidence: number | null;
  newConfidence:   number | null;
  /** null when confidence was not measured on both sides — do not render a delta. */
  confidenceDelta: number | null;
  changeOrigin:  'automatic' | 'founder_confirmed';
  affectedRecommendations: Array<{ id: string; title: string | null }>;
  affectedMissions:        Array<{ id: string; title: string | null }>;
}

export interface GrowthBrainCoverage {
  overallScore:  number;
  overallCopy:   string;
  dimensions:    IntelligenceDimension[];
  connectionStates: Record<string, CanonicalConnectionState>;
  connections:   {
    app_store_connect: { connected: boolean; connectedAt: string | null; syncStatus: string | null };
    revenue_cat:       { connected: boolean; connectedAt: string | null; syncStatus: string | null };
    google_analytics:  { connected: boolean; connectedAt: string | null; syncStatus: string | null };
    google_ads:        { connected: boolean; connectedAt: string | null; syncStatus: string | null };
    meta_ads:          { connected: boolean; connectedAt: string | null; syncStatus: string | null };
    connectedCount:    number;
  };
  recommendedSource: {
    key:             string;
    name:            string;
    logoChar:        string;
    description:     string;
    decisionImproved: string;
    expectedGain:    string;
    accessType:      string;
    /** False when no real integration exists yet. */
    available:       boolean;
    connectionStatus: string;
  } | null;
  contextSummary: {
    positioning:    string;
    audience:       string;
    topSignal:      string;
    nextInitiative: string;
    primaryGoal:    string;
    targetWindow:   string;
  };
  lastLearning: {
    trigger:        string;
    actionTaken:    string;
    /** "No measured change" when confidence was not measured on both sides. */
    confidenceLift: string;
    /** Whether LaunchMind concluded this itself or a person confirmed it. */
    origin:         'automatic' | 'founder_confirmed';
  } | null;
  /**
   * Evidence-backed insights derived from connected sources. The same persisted
   * rows feed Growth Brain, the Morning Brief, and Improve Intelligence, so the
   * three surfaces cannot disagree.
   */
  liveInsights: Array<{
    id:         string;
    provider:   string;
    headline:   string;
    detail:     string;
    evidence:   unknown;
    confidence: number | null;
    createdAt:  string;
  }>;
}

// ── Connections (Improve Intelligence) ────────────────────────────────────────

export interface WorkspaceConnection {
  id: string;
  provider: string;
  status: 'NOT_CONNECTED'|'PREVIEWING'|'AUTHORIZING'|'AUTHORIZED'|'SELECTING_SOURCE'|
          'SYNC_QUEUED'|'SYNCING'|'PARTIAL'|'HEALTHY'|'NO_HISTORY'|'NEEDS_REAUTH'|
          'PERMISSION_DENIED'|'WRONG_ACCOUNT'|'PROVIDER_UNAVAILABLE'|'SYNC_FAILED'|'DISCONNECTED';
  external_account_name?: string;
  selected_resource_name?: string;
  freshness_status?: 'fresh'|'stale'|'unknown';
  last_synced_at?: string;
  error_detail?: string;
  created_at: string;
  updated_at: string;
}

export interface ProviderAccount {
  id: string;
  name: string;
  accessLevel?: string;
}

/**
 * Canonical permission ladder. A connection is granted READ + RECOMMEND at connect
 * time; CHANGE, PUBLISH, and SPEND require an explicit, audited authority upgrade.
 */
export type PermissionLevel = 'READ' | 'RECOMMEND' | 'DRAFT' | 'CHANGE' | 'PUBLISH' | 'SPEND';

/**
 * Per-action execution boundary for a connection.
 * `allowed` is false for every action today: no adapter implements execution, so even
 * a granted authority cannot produce an external change.
 */
export interface ExecutionBoundary {
  granted: PermissionLevel[];
  actions: Array<{
    action: string;
    requires: PermissionLevel;
    allowed: boolean;
    blockedBy: string | null;
  }>;
  providerExecutionImplemented: boolean;
}

/** One immutable entry in a connection's permission audit trail. */
export interface ConnectionPermissionHistoryEntry {
  id: string;
  connection_id: string;
  workspace_id: string;
  permission_snapshot: PermissionLevel[];
  previous_snapshot: PermissionLevel[];
  action: 'granted' | 'upgrade_requested' | 'upgrade_approved' | 'upgrade_denied'
        | 'downgraded' | 'revoked' | 'reauthorized';
  changed_by: string | null;
  actor_type: 'founder' | 'system';
  reason: string | null;
  created_at: string;
}

export interface SyncRun {
  id: string;
  status: 'queued'|'running'|'completed'|'partial'|'failed';
  progress: number;
  current_step?: string;
  steps_completed: string[];
  signals_imported: number;
  error_message?: string;
  started_at?: string;
  completed_at?: string;
  created_at: string;
}

/**
 * Result of POST /connections/:provider/connect.
 * There is deliberately no `firstInsight` here — an insight only exists once the
 * worker has imported real provider data. Poll sync-runs, then read the signals.
 */
export interface ConnectResult {
  connection: WorkspaceConnection;
  accounts: ProviderAccount[];
  syncRunId: string;
  traceId: string;
  syncQueued: boolean;
  needsResourceSelection: boolean;
}

/** How current a connection's imported data is. */
export type FreshnessLevel = 'fresh' | 'recent' | 'stale' | 'outdated' | 'unknown';

export interface ConnectionHealth {
  status: string;
  freshness: FreshnessLevel;
  /** Owner-facing wording for `freshness`. */
  freshness_label: string;
  last_synced_at?: string;
  signals_count: number;
  provider: string;
  adapter_available: boolean;
  needs_attention: boolean;
  /** Persisted grant. Never inferred from provider token scopes. */
  permissions_granted: PermissionLevel[];
  /** Non-secret credential metadata. No token material is ever returned. */
  credential_expires_at: string | null;
  external_account_name: string | null;
  /** The app / property / account the owner selected at this provider. */
  selected_resource_name: string | null;
  /**
   * Most recent evidence-backed insight derived from this connection's imported
   * data, or null when the data has not yet supported a conclusion.
   */
  latest_insight: {
    headline: string;
    detail: string;
    evidence: unknown;
    confidence: number | null;
    created_at: string;
  } | null;
}
