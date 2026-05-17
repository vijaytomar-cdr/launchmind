/**
 * @file tokenVault.ts
 * @description AES-256 OAuth token encryption/decryption via AWS KMS.
 *   Encrypted ciphertext is stored in platform_tokens.encrypted_token.
 *   The KMS master key never leaves AWS — only ciphertext touches this server or the DB.
 *   In local dev, LocalStack emulates KMS (AWS_KMS_ENDPOINT env var routes there).
 * @security
 *   - Plaintext tokens are NEVER logged, cached, or returned to the frontend.
 *   - Every decryptToken() call writes an audit_log entry BEFORE returning the token.
 *   - founderId is verified by the caller before invoking decryptToken().
 *   - Key ID stored alongside ciphertext to support key rotation without re-auth.
 * @dependencies @aws-sdk/client-kms, supabaseAdmin, audit_logs table
 */

import { KMSClient, EncryptCommand, DecryptCommand } from '@aws-sdk/client-kms';
import { getSupabaseAdmin } from './supabaseAdmin';

function getKmsClient(): KMSClient {
  return new KMSClient({
    region: process.env.AWS_REGION ?? 'us-east-1',
    ...(process.env.AWS_KMS_ENDPOINT
      ? { endpoint: process.env.AWS_KMS_ENDPOINT }
      : {}),
  });
}

/**
 * Encrypts an OAuth token using AWS KMS.
 * @param plaintext - Raw OAuth access or refresh token string
 * @returns         { ciphertext: base64 string, kmsKeyId: ARN of the key used }
 * @throws          {Error} If KMS_KEY_ARN is not set or KMS returns an error
 * @security        Plaintext is converted to Buffer in-memory only. Never logged.
 */
export async function encryptToken(
  plaintext: string
): Promise<{ ciphertext: string; kmsKeyId: string }> {
  const kmsKeyId = process.env.KMS_KEY_ARN;
  if (!kmsKeyId) throw new Error('KMS_KEY_ARN is not configured');

  const client = getKmsClient();
  const response = await client.send(
    new EncryptCommand({
      KeyId: kmsKeyId,
      Plaintext: Buffer.from(plaintext, 'utf-8'),
    })
  );

  if (!response.CiphertextBlob) throw new Error('KMS encrypt returned empty ciphertext');

  return {
    ciphertext: Buffer.from(response.CiphertextBlob).toString('base64'),
    kmsKeyId,
  };
}

/**
 * Decrypts an OAuth token using AWS KMS.
 * Writes an immutable audit_log entry before returning the plaintext.
 * @param ciphertext - Base64 ciphertext from platform_tokens.encrypted_token
 * @param kmsKeyId   - KMS key ARN from platform_tokens.kms_key_id
 * @param founderId  - UUID of the token owner (for audit log)
 * @returns          Decrypted plaintext OAuth token
 * @throws           {Error} If KMS decryption fails or ciphertext is malformed
 * @security         Audit log is written before token is returned. Token never logged or cached.
 */
export async function decryptToken(
  ciphertext: string,
  kmsKeyId: string,
  founderId: string
): Promise<string> {
  await getSupabaseAdmin().from('audit_logs').insert({
    founder_id: founderId,
    action: 'token_decrypted',
    resource_type: 'platform_token',
    metadata: { kmsKeyId },
  });

  const client = getKmsClient();
  const response = await client.send(
    new DecryptCommand({
      CiphertextBlob: Buffer.from(ciphertext, 'base64'),
      KeyId: kmsKeyId,
    })
  );

  if (!response.Plaintext) throw new Error('KMS decrypt returned empty plaintext');

  return Buffer.from(response.Plaintext).toString('utf-8');
}
