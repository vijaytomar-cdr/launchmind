# Secret Rotation Runbook

## When to rotate
- Any suspected credential exposure
- Every 90 days for all API keys (scheduled)
- Immediately on any team member offboarding

## Secrets inventory
| Secret | Location | Rotation steps |
|--------|----------|----------------|
| SUPABASE_SERVICE_ROLE_KEY | Vercel + Oracle VM env | Regenerate in Supabase dashboard → update both locations |
| ANTHROPIC_API_KEY | Oracle VM env + GitHub Actions | Regenerate in Anthropic console → update all locations |
| AWS_ACCESS_KEY_ID / SECRET | Oracle VM env + GitHub Actions | Rotate in IAM console → update all locations |
| STRIPE_SECRET_KEY | Oracle VM env | Rotate in Stripe dashboard (rolling keys) |
| RAZORPAY_KEY_SECRET | Oracle VM env | Regenerate in Razorpay dashboard |
| RESEND_API_KEY | Oracle VM env | Regenerate in Resend dashboard |
| KMS_KEY_ARN | Oracle VM env | Create new key → re-encrypt all tokens → schedule old key deletion |

## KMS key rotation procedure (most complex)
1. Create new KMS key in AWS console
2. Add new key ARN to env as KMS_KEY_ARN_NEW (temporary)
3. Run migration script: `npm run scripts:re-encrypt-tokens`
4. Verify all tokens decrypt successfully with new key
5. Swap KMS_KEY_ARN to new value, remove KMS_KEY_ARN_NEW
6. Schedule old key for deletion (30 day grace period)

## After any rotation
- Log the rotation in docs/access-requests.md
- Verify health check: curl https://api.launchmind.com/health
