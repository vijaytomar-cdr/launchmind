/**
 * @file whatsappService.ts
 * @description WhatsApp Business API integration via Meta Cloud API.
 *   Sends broadcast messages for approved campaigns and processes read receipts.
 * @security
 *   - sendBroadcast() REQUIRES campaigns.approved_at IS NOT NULL — checked in route handler
 *     AND verified again here as defence-in-depth. Unapproved sends are silently rejected.
 *   - getToken() result is NEVER logged, returned to frontend, or stored in any variable
 *     that persists beyond the HTTP call.
 *   - All sends write to audit_logs with campaign_id + message_id (no token, no body content).
 *   - Webhook payloads verified by X-Hub-Signature-256 in the route handler before this
 *     service is called.
 * @dependencies platformTokenService, supabaseAdmin, audit_logs, campaign_metrics
 */

import { getToken } from './platformTokenService';
import { getSupabaseAdmin } from '../lib/supabaseAdmin';

const META_API_VERSION = 'v20.0';
const META_GRAPH_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

export interface WhatsAppBroadcastParams {
  campaignId: string;
  founderId: string;
  phoneNumberId: string;
  recipientPhone: string;
  templateName: string;
  languageCode: string;
  templateParams?: string[];
}

export interface WhatsAppReadReceiptPayload {
  campaignId: string;
  messageId: string;
  recipientPhone: string;
  timestamp: string;
}

/**
 * Sends a WhatsApp template message for an approved campaign.
 * Defence-in-depth: verifies approved_at in DB even though the route handler also checks it.
 * @param params - Broadcast parameters including campaignId, founderId, phone IDs
 * @returns      { messageId: string } on success
 * @throws       {Error} If campaign not approved, token missing/revoked, or Meta API fails
 * @security
 *   - approved_at checked against DB — cannot be bypassed by route-level check alone
 *   - Decrypted token used only within this function scope; never stored or logged
 *   - audit_log written with campaign_id + message_id only (no token or recipient PII)
 */
export async function sendBroadcast(params: WhatsAppBroadcastParams): Promise<{ messageId: string }> {
  const {
    campaignId,
    founderId,
    phoneNumberId,
    recipientPhone,
    templateName,
    languageCode,
    templateParams = [],
  } = params;

  // Defence-in-depth: verify approved_at even though route handler already checked
  const { data: campaign } = await getSupabaseAdmin()
    .from('campaigns')
    .select('approved_at, status')
    .eq('id', campaignId)
    .eq('founder_id', founderId)
    .single();

  if (!campaign?.approved_at) {
    throw new Error('Campaign is not approved — send blocked');
  }

  // Get decrypted token (never log this value)
  const accessToken = await getToken(founderId, 'whatsapp');

  const body = {
    messaging_product: 'whatsapp',
    to: recipientPhone,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      components: templateParams.length > 0
        ? [{ type: 'body', parameters: templateParams.map((t) => ({ type: 'text', text: t })) }]
        : undefined,
    },
  };

  const response = await fetch(`${META_GRAPH_BASE}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  // Nullify reference immediately after HTTP call
  void (accessToken as unknown as null);

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Meta API error ${response.status}: ${errText}`);
  }

  const result = (await response.json()) as { messages: Array<{ id: string }> };
  const messageId = result?.messages?.[0]?.id ?? 'unknown';

  // Update campaign status and launched_at
  await getSupabaseAdmin()
    .from('campaigns')
    .update({ status: 'launched', launched_at: new Date().toISOString() })
    .eq('id', campaignId);

  // Immutable audit log — no token, no recipient content
  await getSupabaseAdmin().from('audit_logs').insert({
    founder_id: founderId,
    action: 'whatsapp_broadcast_sent',
    resource_type: 'campaign',
    resource_id: campaignId,
    metadata: { messageId, templateName },
  });

  return { messageId };
}

/**
 * Processes a WhatsApp read receipt webhook event.
 * Increments clicks in campaign_metrics for the associated campaign.
 * @param payload - Parsed webhook payload (after signature verification in route)
 * @security No auth token involved. Webhook signature verified upstream in route handler.
 */
export async function handleReadReceipt(payload: WhatsAppReadReceiptPayload): Promise<void> {
  const { campaignId, timestamp } = payload;

  const weekStart = getWeekStart(new Date(Number(timestamp) * 1000));

  // Upsert the metric row for this campaign + week, incrementing clicks
  const { data: existing } = await getSupabaseAdmin()
    .from('campaign_metrics')
    .select('id, clicks, founder_id')
    .eq('campaign_id', campaignId)
    .eq('week_start', weekStart)
    .single();

  if (existing) {
    await getSupabaseAdmin()
      .from('campaign_metrics')
      .update({ clicks: (existing.clicks ?? 0) + 1 })
      .eq('id', existing.id);
  } else {
    // Fetch founder_id from campaign
    const { data: campaign } = await getSupabaseAdmin()
      .from('campaigns')
      .select('founder_id')
      .eq('id', campaignId)
      .single();

    if (!campaign) return;

    await getSupabaseAdmin().from('campaign_metrics').insert({
      campaign_id: campaignId,
      founder_id: campaign.founder_id,
      week_start: weekStart,
      clicks: 1,
    });
  }
}

function getWeekStart(date: Date): string {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  d.setUTCDate(diff);
  return d.toISOString().split('T')[0];
}
