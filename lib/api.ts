/**
 * @file api.ts
 * @description Type-safe API client for the LaunchMind Fastify backend.
 *   All frontend → backend calls route through this file.
 *   Never calls Supabase directly — that is the backend's job.
 * @security Auth token from Supabase session is attached as Bearer header.
 *   Never logs tokens. All errors surfaced as typed ApiError.
 * @dependencies @supabase/ssr (for session token), fetch
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  path: string,
  options: RequestInit & { token?: string } = {}
): Promise<T> {
  const { token, ...fetchOptions } = options;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(fetchOptions.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch(`${API_BASE}${path}`, {
    ...fetchOptions,
    headers,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new ApiError(response.status, body.error ?? response.statusText);
  }

  return response.json() as Promise<T>;
}

export const api = {
  health: () => request<{ status: string; timestamp: string }>('/health'),

  products: {
    scrape: (url: string, token: string) =>
      request<ScrapeResult>('/products/scrape', {
        method: 'POST',
        body: JSON.stringify({ url }),
        token,
      }),
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
        method: 'POST', token,
      }),
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
      request<{ revoked: boolean }>('/auth/revoke-sessions', { method: 'POST', token }),
    tokenUsage: (token: string) =>
      request<TokenUsage>('/founders/me/token-usage', { token }),
  },

  brandVoice: {
    preview: (productId: string, copy: string, token: string) =>
      request<BrandVoicePreview>(`/products/${productId}/brand-voice/preview`, {
        method: 'POST', body: JSON.stringify({ copy }), token,
      }),
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
  platform: 'app_store' | 'play_store';
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
  created_at: string;
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
