/**
 * @file auth.middleware.ts
 * @description Anomaly detection for authenticated requests.
 *   Stores last known {ip, userAgent} per founder in Redis.
 *   On IP or user-agent mismatch: writes audit_log + sends Resend security alert.
 *   Non-blocking — fires as void; never delays or rejects the request.
 * @security Alert-only, no request blocking. Founder ID decoded from JWT payload (not re-verified).
 *   Resend email sent to founder's email address on mismatch.
 * @dependencies ioredis, resend, supabaseAdmin
 */

import IORedis from 'ioredis';
import { Resend } from 'resend';
import * as Sentry from '@sentry/node';
import { getSupabaseAdmin } from '../lib/supabaseAdmin';

let _redis: IORedis | null = null;
function getRedis(): IORedis {
  if (!_redis) {
    _redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
  }
  return _redis;
}

function getResend(): Resend {
  return new Resend(process.env.RESEND_API_KEY);
}

interface LastLogin {
  ip: string;
  userAgent: string;
  seenAt: string;
}

/**
 * Fire-and-forget anomaly check. Call after jwtVerify() on any authenticated request.
 * Compares current IP + user-agent to last known values in Redis.
 * On mismatch: writes audit_log + sends Resend alert email. Never throws.
 * @param founderId - UUID of the authenticated founder
 * @param ip        - Request IP address (from x-forwarded-for or socket)
 * @param userAgent - Request user-agent header
 */
export async function checkAnomaly(
  founderId: string,
  ip: string,
  userAgent: string
): Promise<void> {
  try {
    const redis = getRedis();
    const key = `founder:${founderId}:lastLogin`;
    const stored = await redis.get(key);

    const now = new Date().toISOString();
    const current: LastLogin = { ip, userAgent, seenAt: now };

    if (stored) {
      const last: LastLogin = JSON.parse(stored);
      const ipChanged = last.ip !== ip;
      const uaChanged = last.userAgent !== userAgent;

      if (ipChanged || uaChanged) {
        // Write audit log
        void getSupabaseAdmin().from('audit_logs').insert({
          founder_id: founderId,
          action: 'anomalous_login',
          metadata: {
            previousIp: last.ip,
            currentIp: ip,
            previousUserAgent: last.userAgent.substring(0, 100),
            currentUserAgent: userAgent.substring(0, 100),
            ipChanged,
            uaChanged,
          },
        });

        // Send alert email (non-fatal)
        void sendAnomalyAlert(founderId, ip, last.ip, ipChanged, uaChanged);
      }
    }

    // Update Redis with current login info (TTL: 30 days)
    await redis.setex(key, 60 * 60 * 24 * 30, JSON.stringify(current));
  } catch (err) {
    // Anomaly check is non-fatal — log to Sentry but never block the request
    Sentry.captureException(err, { tags: { middleware: 'anomalyCheck', founderId } });
  }
}

async function sendAnomalyAlert(
  founderId: string,
  newIp: string,
  oldIp: string,
  ipChanged: boolean,
  uaChanged: boolean
): Promise<void> {
  try {
    const { data: founder } = await getSupabaseAdmin()
      .from('founders')
      .select('email')
      .eq('id', founderId)
      .single();

    if (!founder?.email) return;

    const resend = getResend();
    const changes: string[] = [];
    if (ipChanged) changes.push(`New IP address: <strong>${newIp}</strong> (previously ${oldIp})`);
    if (uaChanged) changes.push('New browser or device detected');

    await resend.emails.send({
      from: 'LaunchMind Security <security@launchmind.com>',
      to: founder.email,
      subject: 'New sign-in detected on your LaunchMind account',
      html: `
        <h2>New sign-in detected</h2>
        <p>We noticed a new sign-in to your LaunchMind account:</p>
        <ul>${changes.map((c) => `<li>${c}</li>`).join('')}</ul>
        <p>If this was you, no action is needed.</p>
        <p>If you don't recognise this activity, <a href="${process.env.APP_BASE_URL ?? 'https://app.launchmind.com'}/dashboard/settings">review your active sessions</a> and change your password immediately.</p>
        <p style="font-size:12px;color:#888">LaunchMind Security Team</p>
      `,
    });
  } catch (err) {
    Sentry.captureException(err, { tags: { action: 'anomalyAlertEmail' } });
  }
}

/**
 * Extracts founderId from a raw JWT string without verifying the signature.
 * Used only for anomaly detection — NOT for authorization decisions.
 * @param authHeader - Value of the Authorization header (Bearer <token>)
 * @returns founderId (sub claim) or null if header is absent/malformed
 */
export function extractFounderIdFromHeader(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  try {
    const token = authHeader.slice(7);
    const payload = token.split('.')[1];
    if (!payload) return null;
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof decoded.sub === 'string' ? decoded.sub : null;
  } catch {
    return null;
  }
}
