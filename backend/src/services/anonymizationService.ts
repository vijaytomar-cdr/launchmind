/**
 * @file anonymizationService.ts
 * @description PII stripping and audit for data written to playbook_signals.
 *   playbook_signals is the aggregate learning table — it must NEVER contain any
 *   data that could identify a specific founder, product, or user.
 * @security
 *   - auditForPII() MUST be called before every playbook_signals INSERT.
 *   - If auditForPII() throws PII_DETECTED, the INSERT must not proceed.
 *   - anonymize() removes all known PII fields and patterns.
 *   - Fields allowed in playbook_signals: category, market, channel, hook_type,
 *     price_tier, install_delta_pct, conversion_rate, retention_d7, week_number.
 *     All other fields are disallowed.
 * @dependencies None — pure functions, no external I/O.
 */

/** Fields that must never appear in playbook_signals */
const PII_FIELD_NAMES = new Set([
  'founder_id',
  'founderId',
  'product_id',
  'productId',
  'campaign_id',
  'campaignId',
  'email',
  'name',
  'phone',
  'phone_number',
  'phoneNumber',
  'store_url',
  'storeUrl',
  'ip_address',
  'ipAddress',
  'ip',
  'user_agent',
  'userAgent',
  'address',
  'first_name',
  'firstName',
  'last_name',
  'lastName',
  'full_name',
  'fullName',
  'user_id',
  'userId',
  'owner_id',
  'ownerId',
  'external_id',
  'externalId',
]);

/** Regex patterns that indicate PII in string values */
const PII_VALUE_PATTERNS = [
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i, // UUID
  /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,                  // email
  /^\+?[0-9\s\-().]{7,20}$/,                                             // phone
  /^https?:\/\//,                                                         // URL (store URLs)
  /^(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)$/, // IP
];

/** Fields allowed to pass through to playbook_signals */
const ALLOWLIST_FIELDS = new Set([
  'category',
  'market',
  'channel',
  'hook_type',
  'hookType',
  'price_tier',
  'priceTier',
  'install_delta_pct',
  'installDeltaPct',
  'conversion_rate',
  'conversionRate',
  'retention_d7',
  'retentionD7',
  'week_number',
  'weekNumber',
]);

export class PIIDetectedError extends Error {
  constructor(
    public field: string,
    public reason: string
  ) {
    super(`PII_DETECTED: field="${field}" reason="${reason}"`);
    this.name = 'PIIDetectedError';
  }
}

/**
 * Strips all PII fields and returns only the allowlisted aggregate fields.
 * Input can be any object; output is a plain record with only safe fields.
 * @param data - Raw data object (e.g. campaign metric row)
 * @returns    Safe aggregate-only record for playbook_signals
 */
export function anonymize(data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (ALLOWLIST_FIELDS.has(key)) {
      result[key] = value;
    }
    // All other fields are silently dropped
  }
  return result;
}

/**
 * Audits a data object for PII before it is written to playbook_signals.
 * Throws PIIDetectedError immediately on first PII field found.
 * MUST be called before every playbook_signals INSERT — if this throws, do not insert.
 * @param data - Object to audit
 * @throws {PIIDetectedError} On first detected PII field or value pattern
 * @security Fail-safe: throws on detection, never logs the PII value itself.
 */
export function auditForPII(data: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(data)) {
    // Reject known PII field names
    if (PII_FIELD_NAMES.has(key)) {
      throw new PIIDetectedError(key, 'field name is in PII blocklist');
    }

    // Reject non-allowlisted fields (defence-in-depth after anonymize())
    if (!ALLOWLIST_FIELDS.has(key)) {
      throw new PIIDetectedError(key, 'field is not in playbook_signals allowlist');
    }

    // Check string values for PII patterns
    if (typeof value === 'string' && value.length > 0) {
      for (const pattern of PII_VALUE_PATTERNS) {
        if (pattern.test(value.trim())) {
          throw new PIIDetectedError(key, `value matches PII pattern: ${pattern.source.substring(0, 40)}`);
        }
      }
    }
  }
}

/**
 * Convenience: anonymize then auditForPII in one call.
 * Returns the safe record if audit passes, throws PIIDetectedError otherwise.
 * @param data - Raw metric or signal object
 * @returns    Anonymised, audited record safe for playbook_signals
 * @throws {PIIDetectedError} If the anonymized record still contains PII
 */
export function anonymizeAndAudit(data: Record<string, unknown>): Record<string, unknown> {
  const safe = anonymize(data);
  auditForPII(safe);
  return safe;
}
