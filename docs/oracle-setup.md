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
