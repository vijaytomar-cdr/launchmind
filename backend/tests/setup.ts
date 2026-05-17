/**
 * @file setup.ts
 * @description Vitest global setup — sets required env vars before any test module is loaded.
 *   Prevents real AWS/Supabase calls during unit tests.
 */

process.env.NODE_ENV = 'test';
process.env.SUPABASE_JWT_SECRET = 'test-jwt-secret-min-32-chars-long!!';
process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.AWS_REGION = 'us-east-1';
process.env.KMS_KEY_ARN = 'arn:aws:kms:us-east-1:000000000000:key/test-key-id';
