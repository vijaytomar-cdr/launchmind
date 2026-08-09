## Oracle Cloud VM Setup (run once)

### 1. Create the VM
- Oracle Cloud Console → Compute → Create Instance
- Shape: VM.Standard.A1.Flex (ARM — 4 OCPUs, 24GB RAM FREE)
  or VM.Standard.E2.1.Micro (AMD — 1 OCPU, 1GB RAM FREE)
- Image: Ubuntu 22.04
- Add your SSH public key
- Open ports 22, 80, 443 in the Security List

### 2. SSH into the VM
ssh ubuntu@YOUR_ORACLE_VM_IP

### 3. Install Docker
sudo apt update && sudo apt upgrade -y
sudo apt install -y docker.io docker-compose-plugin nginx certbot python3-certbot-nginx
sudo usermod -aG docker ubuntu
newgrp docker

### 4. Get SSL certificate
sudo certbot --nginx -d YOUR_DOMAIN

### 5. Set up project directory
sudo mkdir -p /opt/launchmind
sudo chown ubuntu:ubuntu /opt/launchmind
# Copy docker-compose.prod.yml, nginx.conf, oracle-deploy.sh to /opt/launchmind
# Copy .env.production to /opt/launchmind (gitignored — never committed)

### 6. Login to Oracle Container Registry
docker login REGION.ocir.io -u TENANCY/USER@EMAIL

### 7. First deploy
cd /opt/launchmind && bash oracle-deploy.sh

### Ports on the VM
- 80/443: Nginx (public)
- 3001: Fastify API (internal only — not exposed)
- 6379: Redis (internal only — not exposed)

---

## 8. Credential vault — OCI Vault / Key Management

LaunchMind encrypts every provider credential, OAuth access/refresh token, and PKCE
verifier through OCI Vault. **AWS KMS has been removed** — the database was verified
to hold zero AWS-encrypted rows before removal, so there is no legacy decrypt path.

### 8.1 Create the vault and key (once)

Console → Identity & Security → Vault:

1. Create a **Vault** in the compartment that holds LaunchMind.
2. Inside it create a **Master Encryption Key** — AES, 256-bit, software or HSM.
3. Copy two values:
   - the **key OCID** (`ocid1.key.oc1...`)
   - the vault's **Cryptographic endpoint** (`https://<prefix>-crypto.kms.<region>.oraclecloud.com`)

The *management* endpoint is not needed: the application encrypts and decrypts but
never creates, rotates, or deletes keys. Nor is the vault OCID or compartment OCID —
the crypto endpoint already identifies the vault.

### 8.2 Production authentication — Instance Principal

The API runs as a Docker container on an OCI Compute VM, so the correct model is
**Instance Principal**: the VM obtains a short-lived identity from the metadata
service. No user API key, no private key on disk, nothing long-lived to rotate.

Resource Principal is deliberately not used — it applies to Functions, OKE workload
identity, and Data Science, none of which describe this deployment.

**Dynamic group** (Identity → Domains → Dynamic Groups):

```
ALL {instance.id = '<OCID_OF_LAUNCHMIND_VM>'}
```

**Policy** (least privilege — scoped to the single key):

```
Allow dynamic-group launchmind-api-instances
  to use keys in compartment <COMPARTMENT_NAME>
  where target.key.id = '<OCID_OF_LAUNCHMIND_KEY>'

Allow dynamic-group launchmind-api-instances
  to use key-delegate in compartment <COMPARTMENT_NAME>
  where target.key.id = '<OCID_OF_LAUNCHMIND_KEY>'
```

`use keys` covers Encrypt/Decrypt/GenerateDataKey. It does **not** grant create,
rotate, schedule-deletion, or vault management. Do not grant `manage vaults`,
`manage keys`, or any tenancy-level statement. The `where target.key.id` clause is
what stops a compromised VM from touching other keys in the same compartment.

### 8.3 Production environment (`/opt/launchmind/.env.production`)

```
OCI_VAULT_AUTH_MODE=instance_principal
OCI_VAULT_KEY_OCID=ocid1.key.oc1...
OCI_VAULT_CRYPTO_ENDPOINT=https://<prefix>-crypto.kms.<region>.oraclecloud.com
OCI_REGION=<region>
```

No AWS variables. No OCI user API key. No private key.

### 8.4 Container networking caveat

Instance Principal reaches the metadata service at `169.254.169.254`. The API
container must be able to route to that link-local address — default bridge
networking allows it. A hardened iptables rule or a `network_mode` change would
break the vault at the first encrypt, and the symptom is a `503
CREDENTIAL_VAULT_UNAVAILABLE` with `reason=unreachable`.

The application's own SSRF guard blocks that address for *owner-supplied* URLs, which
matters more here than it did under static AWS keys: the metadata service is what
vends the identity that unlocks the vault.

### 8.5 Verifying the vault

```bash
curl -s https://<API_HOST>/health/detailed | jq .vault
# { "status": "healthy", "detail": "Encrypt and decrypt verified." }
```

The probe encrypts and decrypts a fixed sentinel — non-destructive, stores nothing.
It reports four distinct states: `healthy`, `config_error`, `auth_failure`,
`unavailable`. No OCID, endpoint, or SDK text ever appears in the response.
