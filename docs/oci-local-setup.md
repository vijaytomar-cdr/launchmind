# Configure OCI locally and run the live vault test

Five values are needed. **Four come from the Oracle Cloud console — nobody can
generate them for you**, because they identify your tenancy and your key. The fifth
is a fixed literal.

| Value | Where it comes from |
|---|---|
| `OCI_VAULT_AUTH_MODE` | fixed: `config_file` |
| `OCI_REGION` | console, top-right region menu |
| `OCI_VAULT_KEY_OCID` | console, after you create a key |
| `OCI_VAULT_CRYPTO_ENDPOINT` | console, on the vault's detail page |
| `~/.oci/config` | console generates the whole file for you |

You do **not** need the OCI CLI. The console prints the config file contents.

Check progress at any point with:

```bash
node scripts/check-oci-vault.mjs
```

---

## Part 1 — API key and `~/.oci/config` (~5 min)

This is the identity your laptop uses to call OCI.

1. Sign in at **https://cloud.oracle.com**.
2. Top-right **profile icon** → click **your username** (opens User details).
   *Newer consoles:* ☰ → **Identity & Security** → **Domains** → your domain →
   **Users** → your user.
3. Left panel, under Resources → **API keys** → **Add API key**.
4. Keep **Generate API key pair** selected → **Download private key**. Save it, then:

   ```bash
   mkdir -p ~/.oci
   mv ~/Downloads/*.pem ~/.oci/oci_api_key.pem
   chmod 600 ~/.oci/oci_api_key.pem
   ```

   The `chmod` is required — the SDK refuses a key any other user can read.

5. Click **Add**. The console now shows a **Configuration file preview**. Copy it.
6. Paste it into `~/.oci/config`:

   ```bash
   nano ~/.oci/config      # or: open -e ~/.oci/config
   chmod 600 ~/.oci/config
   ```

   It should end up looking like this — five keys under `[DEFAULT]`:

   ```ini
   [DEFAULT]
   user=ocid1.user.oc1..aaaa...
   fingerprint=12:34:56:78:90:ab:cd:ef:...
   tenancy=ocid1.tenancy.oc1..aaaa...
   region=uk-london-1
   key_file=~/.oci/oci_api_key.pem
   ```

   **Change the `key_file` line** — the console writes a placeholder path. Point it
   at the file you saved in step 4.

Verify:

```bash
node scripts/check-oci-vault.mjs      # section 1 and 2 should be all ✓
```

The fingerprint it prints must match the one listed in the console. If it doesn't,
the `key_file` and the API key entry are from different pairs.

---

## Part 2 — Vault and key (~5 min, plus provisioning wait)

1. ☰ → **Identity & Security** → **Key Management & Secret Management** → **Vault**.
2. Pick your compartment (top-left) → **Create Vault**.
   - Name: `launchmind-vault`
   - **Leave "Make it a virtual private vault" UNCHECKED.** A virtual private vault
     is a paid dedicated partition; the shared vault is what you want here.
3. Wait until the vault shows **ACTIVE**. This genuinely takes a few minutes.
4. Open the vault → left panel **Master Encryption Keys** → **Create Key**.
   - Protection Mode: **Software**
     *(HSM keys are billed per key version per month; software keys are not. For a
     credential vault, software protection is the normal choice.)*
   - Algorithm: **AES**, Length: **256 bits**
   - Name: `launchmind-credential-key`
5. Collect the two values:
   - **Key OCID** — click the key → ⋮ or the OCID field → **Copy**.
     Starts `ocid1.key.oc1...`
     ⚠️ Not the *vault* OCID (`ocid1.vault.`) — different thing, and the error you
     get from mixing them up is unhelpful.
   - **Cryptographic endpoint** — go **back to the vault detail page**. There are two
     endpoints listed; you want the one containing `-crypto.`:
     `https://<prefix>-crypto.kms.<region>.oraclecloud.com`
     ⚠️ The *management* endpoint looks almost identical and fails with a confusing
     404. The pre-flight warns you if you copy the wrong one.

---

## Part 3 — Run the live round trip

Do **not** put these in `.env.local` yet — run them inline first, so a typo doesn't
end up saved in a file:

```bash
cd /Users/vtomar/opt/launchMind

OCI_VAULT_AUTH_MODE=config_file \
OCI_CONFIG_PROFILE=DEFAULT \
OCI_REGION=<your-region> \
OCI_VAULT_KEY_OCID=<your-key-ocid> \
OCI_VAULT_CRYPTO_ENDPOINT=<your-crypto-endpoint> \
  node scripts/check-oci-vault.mjs
```

All green? Same variables, run the real thing:

```bash
OCI_VAULT_AUTH_MODE=config_file \
OCI_CONFIG_PROFILE=DEFAULT \
OCI_REGION=<your-region> \
OCI_VAULT_KEY_OCID=<your-key-ocid> \
OCI_VAULT_CRYPTO_ENDPOINT=<your-crypto-endpoint> \
  npm run test:vault
```

Expected: **7 passed**, no `[SKIPPED]` lines. That is the gate for Step 9B.

Once it passes, add the five lines to `.env.local` so the running backend picks them
up — the full variable reference now lives as commented entries at the bottom of `.env.local`.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| All tests `[SKIPPED]` | An env var is unset or still a placeholder. Run the pre-flight. |
| `NotAuthenticated` / `reason=unauthorized` | Fingerprint, key file, and console entry don't match — or the key was added under a different user. |
| `NotAuthorizedOrNotFound` on a key that exists | Your user lacks `use keys` on it. As tenancy admin you have this implicitly; otherwise you need the policy in `docs/oracle-setup.md` §8.2. |
| 404 from the endpoint | You copied the **management** endpoint, not the crypto one. |
| `ETIMEDOUT` / `ENOTFOUND` | Wrong region in the endpoint, or the vault is still provisioning. |
| SDK complains about key permissions | `chmod 600 ~/.oci/oci_api_key.pem` |

## What this does *not* set up

Production. The Oracle VM uses **Instance Principal** — no API key, no `~/.oci/config`,
nothing long-lived. That's a dynamic group plus an IAM policy, documented in
`docs/oracle-setup.md` §8.2. The `~/.oci/config` you just created is for your laptop
only.
