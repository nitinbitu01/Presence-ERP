# ⚠️ SECURITY INCIDENT — Credential Exposure Response

> **Date Identified:** 2026-08-01  
> **Severity:** P1 — Live credentials in distributable archive  
> **Status:** REMEDIATION IN PROGRESS

---

## What Happened

The file `.env` containing live API credentials was not listed in `.gitignore` and was included in the project zip/archive. The following credentials were exposed:

| Credential | Type | Action Required |
|---|---|---|
| `RESEND_API_KEY` (format `re_...`) | **Server secret** — email sending | 🔴 **ROTATE NOW** |
| `SUPABASE_URL` | Public project URL | ⚠️ Low risk (URL is public) |
| `SUPABASE_PUBLISHABLE_KEY` | Public anon key (protected by RLS) | ⚠️ Rotate if shared widely |

---

## Immediate Actions (Do This Now — In Order)

### 1. Rotate Resend API Key
```
1. Go to: https://resend.com/api-keys
2. Click the exposed key → "Revoke"
3. Click "Create API Key" → generate new key
4. Update your deployment secrets (Cloudflare Pages → Settings → Environment Variables)
5. Do NOT put the new key in .env or any file tracked by git
```

### 2. Rotate Supabase Anon Key (if project was shared)
```
1. Go to: https://supabase.com/dashboard/project/YOUR_PROJECT_ID/settings/api
2. Click "Generate new anon key" 
3. Update SUPABASE_PUBLISHABLE_KEY / VITE_SUPABASE_PUBLISHABLE_KEY in deployment
4. All current browser sessions using the old key will be invalidated
```

### 3. Check Git History for Past Exposures
Run this on the REAL repository (not the zip):
```bash
git log --all --full-history -- .env
git log --all --full-history -- '**/.env'
```
If .env appears in any commit:
```bash
# Use BFG Repo Cleaner or git filter-branch to purge .env from all history
# Then force-push to all remotes
# Invalidate ALL credentials from any commit where .env appeared
```

### 4. Audit Cloudflare Pages / Deployment Logs
- Check if the zip was distributed to any external parties
- Review Resend email sending logs for unauthorized usage
- Review Supabase auth logs for suspicious sign-ins

---

## What Was Fixed in Codebase

- `.env` added to `.gitignore` (was missing — only `.dev.vars` was excluded)
- `.env.local`, `.env.*.local`, `.env.development`, `.env.staging`, `.env.production` all added to `.gitignore`
- `.env.example` created with placeholder values and rotation instructions
- The `.env` file in this archive has been redacted (all secrets replaced with `ROTATE_AND_REPLACE`)

---

## Prevention Going Forward

1. **Secrets Manager**: Move all secrets to Cloudflare Pages environment variables or a vault — never in files
2. **Pre-commit Hook**: Install `git-secrets` or `detect-secrets`:
   ```bash
   pip install detect-secrets
   detect-secrets scan > .secrets.baseline
   ```
3. **CI Check**: Add `detect-secrets audit .secrets.baseline` to CI pipeline
4. **`.env.example`**: Only ever commit the example file, never the real `.env`

---

## Timeline

| Time | Event |
|---|---|
| 2026-08-01 00:56 IST | Credentials discovered in .env during security review |
| 2026-08-01 00:56 IST | .gitignore updated, .env redacted, .env.example created |
| PENDING | Resend key rotation |
| PENDING | Supabase key rotation (if needed) |
| PENDING | Git history audit on real repository |
