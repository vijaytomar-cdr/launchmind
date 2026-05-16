#!/bin/bash
##
## @file oracle-deploy.sh
## @description Pulls latest Docker image from OCIR and restarts
##   the API container on the Oracle Cloud VM.
##   Called by GitHub Actions CI/CD on every merge to main.
##   Run on the Oracle VM directly for manual deploys.
##
## @usage
##   SSH into VM: ssh ubuntu@YOUR_ORACLE_VM_IP
##   Manual deploy: ./oracle-deploy.sh
##
set -e
echo "[LaunchMind] Pulling latest image..."
docker pull ${OCIR_REGION}.ocir.io/${OCIR_NAMESPACE}/launchmind-api:latest
echo "[LaunchMind] Restarting containers..."
docker compose -f /opt/launchmind/docker-compose.prod.yml up -d --no-deps api
echo "[LaunchMind] Deploy complete."
curl -sf http://localhost:3001/health || (echo "Health check failed!" && exit 1)
