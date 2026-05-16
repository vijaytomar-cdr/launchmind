# Incident Response Playbook

## Severity levels
- **P0**: Production down, data breach, or active exploit — respond immediately
- **P1**: Partial outage or degraded performance — respond within 1 hour
- **P2**: Non-critical issue — respond within 24 hours

## P0 Response steps
1. **Contain**: Isolate affected systems. If breach: revoke all secrets immediately.
2. **Assess**: Determine scope. Check Axiom audit logs and Sentry.
3. **Communicate**: Notify affected founders via Resend if data involved.
4. **Remediate**: Fix root cause, rotate credentials, re-deploy.
5. **Post-mortem**: Document in this file within 48h.

## Common scenarios

### Suspected credential leak
1. Immediately rotate all secrets (see docs/security/secret-rotation.md)
2. Check git history: `git grep -rE "(key|secret|password|token)\s*=\s*['\"][^'\"]{8,}"`
3. Check Axiom for unusual audit log entries
4. File incident report below

### Oracle VM compromise
1. Create new VM immediately
2. Rotate all secrets
3. Deploy from OCIR to new VM
4. Update DNS
5. Terminate old VM

## Incident log
<!-- Add entries here in reverse chronological order -->
<!-- Format: ## YYYY-MM-DD: Brief title -->
