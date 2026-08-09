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
| ~~AWS_ACCESS_KEY_ID / SECRET~~ | **REMOVED** | AWS KMS replaced by OCI Vault. Production uses Instance Principal — there is no static cloud credential left to rotate. |
| STRIPE_SECRET_KEY | Oracle VM env | Rotate in Stripe dashboard (rolling keys) |
| RAZORPAY_KEY_SECRET | Oracle VM env | Regenerate in Razorpay dashboard |
| RESEND_API_KEY | Oracle VM env | Regenerate in Resend dashboard |
| OCI_VAULT_KEY_OCID | Oracle VM env | Create new key → re-encrypt → schedule old key deletion (see below) |

## OCI Vault key rotation procedure (most complex)

Rotation is possible without forcing a single founder to reconnect, because every
ciphertext is stored with the key OCID that produced it (`kms_key_id` column — the
name predates OCI and now holds an `ocid1.key...`). Decryption always uses the key
recorded WITH the row, not the currently-configured key.

1. Create a new Master Encryption Key in the same OCI Vault.
2. Extend the IAM policy to permit BOTH key OCIDs (old and new) for the duration.
3. Point `OCI_VAULT_KEY_OCID` at the new key and redeploy. New writes use the new
   key immediately; existing rows keep decrypting under the old one.
4. Re-encrypt in place, per row: decrypt with the stored `kms_key_id`, encrypt with
   the new key, write ciphertext and the new key id together in one update. Do this
   in batches, and never delete a row that fails — leave it on the old key and
   investigate.
5. Confirm zero rows remain on the old key:
   `select kms_key_id, count(*) from connection_credentials group by 1;`
   Repeat for `platform_tokens` and `oauth_authorization_requests`.
6. Remove the old key OCID from the IAM policy.
7. Only then schedule the old key for deletion (OCI enforces a 7–30 day waiting
   period — do not shorten it; it is the recovery window if step 5 missed rows).

Verify after every step:

```bash
curl -s https://<API_HOST>/health/detailed | jq .vault    # expect status: healthy
```

### Rotating the workload identity

There is nothing to rotate. Instance Principal credentials are short-lived and
issued by the OCI metadata service. If the VM is replaced, add the new instance OCID
to the dynamic group; no secret changes hands.

## After any rotation
- Log the rotation in docs/access-requests.md
- Verify health check: curl https://api.launchmind.com/health

## Meta app credentials

Canonical: `META_ADS_CLIENT_ID` / `META_ADS_CLIENT_SECRET`.

`META_ADS_APP_ID` / `META_ADS_APP_SECRET` are deprecated aliases accepted for one
release; the server logs a startup warning while they are in use. To migrate, copy
the values to the canonical names and delete the aliases — no code change, no
downtime, and the startup warning stops.

Rotating the Meta app secret is a straight swap: update one variable and restart.
Existing provider tokens already in the vault are unaffected — they are encrypted
with the OCI key, not with the Meta secret.

`WHATSAPP_APP_ID` / `WHATSAPP_APP_SECRET` belong to a **different Meta app** and
rotate independently.
