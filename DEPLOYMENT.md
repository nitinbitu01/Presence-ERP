# Deployment Guide: Presence Attendance ERP

## Overview

Presence is a hardened biometric attendance system with face recognition, geofencing, and liveness detection. This guide covers environment setup, database migrations, deployment steps, and troubleshooting.

---

## Prerequisites

- Node.js 18+ (20+ recommended)
- Supabase account with a project
- Resend email service account (for notifications)
- (Optional) AWS/GCP account for cloud deployment
- Git for version control

---

## Environment Variables

Create a `.env.local` file in the root directory with the following:

### Supabase Configuration

```
VITE_SUPABASE_URL=https://[PROJECT-REF].supabase.co
VITE_SUPABASE_ANON_KEY=[ANON_KEY from Supabase]
```

### Cryptographic Keys (MUST be 32+ characters, generated securely)

```
# 256-bit AES-GCM key (base64-encoded 32 bytes)
BIOMETRIC_ENC_KEY=<base64_encoded_32_bytes>

# HMAC-SHA256 key for challenge signing (base64-encoded 32 bytes)
LIVENESS_HMAC_KEY=<base64_encoded_32_bytes>
```

### Email Notifications (Resend.com)

```
RESEND_API_KEY=<your_resend_api_key>
RESEND_FROM_EMAIL=noreply@yourinstitution.edu
```

### (Optional) Sentry Error Tracking

```
SENTRY_DSN=<your_sentry_dsn>
SENTRY_ENVIRONMENT=production
```

---

## Generating Cryptographic Keys

Use this Node.js script to generate secure random keys:

```javascript
const crypto = require("crypto");

// Generate AES-GCM key (256-bit = 32 bytes)
const aesKey = crypto.randomBytes(32).toString("base64");
console.log("BIOMETRIC_ENC_KEY=" + aesKey);

// Generate HMAC key (256-bit = 32 bytes)
const hmacKey = crypto.randomBytes(32).toString("base64");
console.log("LIVENESS_HMAC_KEY=" + hmacKey);
```

**⚠️ Store these keys securely in your environment; never commit them to version control.**

---

## Database Setup

### 1. Initialize Supabase Database

```bash
# Login to Supabase CLI
npx supabase login

# Link to your Supabase project
npx supabase link --project-ref [PROJECT_REF]

# Push migrations to the database
npx supabase migration up
```

### 2. Verify Migration Success

```bash
# Check Supabase dashboard for:
# - All tables created (users, courses, attendance_ledger, etc.)
# - RLS policies enabled on all tables
# - Triggers and functions in place
```

### 3. Manual Sanity Checks (in Supabase SQL Editor)

```sql
-- Check tables exist
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';

-- Verify RLS is enabled
SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';

-- Check indexes
SELECT indexname FROM pg_indexes WHERE schemaname = 'public';
```

---

## Local Development

### 1. Install Dependencies

```bash
npm install
```

### 2. Start Development Server

```bash
npm run dev
```

The app will be available at `http://localhost:5173` (or the assigned port).

### 3. Run Tests

```bash
npm test
```

### 4. Lint & Format

```bash
npm run lint
npm run format
```

---

## Build & Deployment

### 1. Build for Production

```bash
npm run build
```

This creates an optimized build in the `dist/` directory.

### 2. Preview Build Locally

```bash
npm run preview
```

### 3. Deploy to Hosting

#### Option A: Deploy to Vercel (Recommended)

```bash
npm install -g vercel
vercel --prod
```

#### Option B: Deploy to Netlify

```bash
# Via CLI
npm install -g netlify-cli
netlify deploy --prod --dir=dist

# Or via GitHub integration
# Push to main branch; Netlify auto-deploys from git
```

#### Option C: Deploy to Cloud Run (Google Cloud)

```bash
# Requires Docker
gcloud builds submit --tag gcr.io/[PROJECT]/presence
gcloud run deploy presence --image gcr.io/[PROJECT]/presence --platform managed
```

#### Option D: Deploy to AWS S3 + CloudFront

```bash
# Upload build to S3
aws s3 sync dist/ s3://presence-app-bucket/ --delete

# Invalidate CloudFront cache
aws cloudfront create-invalidation --distribution-id [DIST-ID] --paths "/*"
```

---

## Post-Deployment Checklist

After deploying to production:

### 1. Environment Verification

```bash
# Verify all env vars are set
echo "SUPABASE_URL: $VITE_SUPABASE_URL"
echo "RESEND_API_KEY: [set]"
echo "BIOMETRIC_ENC_KEY: [set]"
```

### 2. Database Connectivity Check

```bash
# Navigate to app and attempt:
# 1. Login (tests Supabase auth)
# 2. View dashboard (tests RLS policies)
# 3. Start biometric enrollment (tests encryption)
```

### 3. Health Check Endpoint

```bash
curl https://your-deployment.com/health 2>/dev/null | jq .

# Expected response:
# {
#   "status": "healthy",
#   "database": "connected",
#   "timestamp": "2026-07-22T10:30:00Z"
# }
```

(Add a `/health` endpoint to `src/routes/health.tsx` if not present)

### 4. Notification Test

```bash
# Trigger a role request in the UI
# Verify notification appears in dashboard
# Check email inbox for email dispatch
```

### 5. Security Headers Check

```bash
curl -I https://your-deployment.com | grep -E "Strict-Transport-Security|Content-Security-Policy|X-Frame-Options"

# Expected:
# Strict-Transport-Security: max-age=31536000; includeSubDomains
# Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'
# X-Frame-Options: DENY
```

---

## Monitoring & Alerting

### 1. Enable Supabase Monitoring

- Navigate to Supabase Dashboard → Monitoring
- Set up alerts for:
  - High database connection count
  - API rate limit hits
  - Slow queries (> 1 second)

### 2. Monitor Application Errors

```bash
# (Optional) Sentry integration
# Navigate to Sentry.io dashboard
# Set up alerts for error spike
```

### 3. Check Admin Health Dashboard

- Navigate to `/admin` in the app
- View:
  - Total verification events
  - Liveness failure rate
  - Review backlog count
  - Fallback requests pending
  - Biometric consent withdrawals

---

## Troubleshooting

### Issue: "VERIFICATION_UNAVAILABLE" errors on enrollment

**Cause:** Face-API models failed to load from CDN (likely network or CORS).

**Fix:**

```bash
# 1. Check browser console for 404 on face-api.js CDN
# 2. Verify the CDN URL is correct in face-api-loader.ts
# 3. If CDN is down, host face-api.min.js locally:

# In public/models/, add face-api.min.js
# Update face-api-loader.ts to load from /models/face-api.min.js
# instead of CDN

# 3. Restart the app
npm run dev
```

### Issue: "Rate limited" on check-in attempts

**Cause:** Student exceeded 5 attempts per session in 1 hour.

**Fix:**

```bash
# Query rate limits in Supabase:
SELECT * FROM public.rate_limit_attempts
WHERE key LIKE 'attend:student:[STUDENT_ID]%'
ORDER BY attempted_at DESC;

# Manual reset (admin only):
DELETE FROM public.rate_limit_attempts
WHERE key LIKE 'attend:student:[STUDENT_ID]%';
```

### Issue: "Mock location detected" geofence rejection

**Cause:** Student's GPS accuracy is unrealistically perfect (< 0.5m).

**Fix:**

```bash
# Instructor can use fallback attendance:
# 1. Student requests fallback in UI
# 2. Teacher approves in dashboard
# 3. Attendance is marked "fallback_present"
# 4. Event logged as "teacher_fallback_override"
```

### Issue: Email notifications not sending

**Cause:** RESEND_API_KEY missing or invalid.

**Fix:**

```bash
# 1. Verify RESEND_API_KEY is set in environment:
echo $RESEND_API_KEY

# 2. Test Resend API key:
curl -X POST https://api.resend.com/emails \
  -H "Authorization: Bearer $RESEND_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"from":"test@resend.com","to":"test@example.com","subject":"Test","html":"<p>Test</p>"}'

# 3. Check logs in Resend dashboard for failed sends

# 4. Fallback: Disable email and rely on in-app notifications only
# (notifications table still works without RESEND_API_KEY)
```

### Issue: "Frame swap detected" liveness failure

**Cause:** Attacker tried to inject a different person's face in one frame.

**Fix:**

```bash
# This is working as intended (security feature).
# Student can:
# 1. Retry the liveness challenge
# 2. Request fallback attendance if camera is genuinely broken
# 3. Contact IT support if issue persists
```

### Issue: "IP not allowed" geofence rejection

**Cause:** Student checked in from IP not in the allowlist.

**Fix:**

1. Check session's IP allowlist in teacher dashboard
2. Add student's IP or broader CIDR range (e.g., `192.168.0.0/16`)
3. **Verify CIDR format:**
   - IPv4: `192.168.1.0/24` ✓
   - IPv6: `2001:db8::/32` ✓
   - Missing prefix defaults to `/32` or `/128` (single IP)

---

## Scaling Considerations

### Database Bottlenecks

- **Attendance events table** grows unboundedly. Add partitioning:
  ```sql
  -- Partition by year
  CREATE TABLE attendance_events_2026 PARTITION OF attendance_events
  FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
  ```

### Rate Limit Table Bloat

- **rate_limit_attempts** table is auto-cleaned by cleanup job.
- If cleanup fails, manually prune old attempts:
  ```sql
  DELETE FROM rate_limit_attempts
  WHERE attempted_at < now() - interval '24 hours';
  ```

### Concurrent Users

- Supabase free tier: 50 simultaneous connections
- Upgrade to Pro for 500+ concurrent users
- For 5000+ users, use Supabase's pooling or dedicated database

---

## Rollback Procedure

If deployment introduces issues:

### 1. Immediate Rollback

```bash
# Revert to previous build (Vercel/Netlify)
# Via dashboard: Deployments → Select previous version → Promote

# Or manually:
git revert HEAD
git push
```

### 2. Database Rollback

```bash
# If a migration introduces schema errors:
npx supabase db reset
# Caution: This wipes the database. Use only in non-production environments.

# For production, create a manual rollback migration:
# (Never drop tables; instead, add a new migration with schema fixes)
```

### 3. Feature Flag (Recommended)

```typescript
// Add feature flags to disable buggy features:
const FEATURES = {
  LIVENESS_DETECTION: process.env.VITE_FEATURE_LIVENESS === 'true',
  GEOFENCING: process.env.VITE_FEATURE_GEOFENCING === 'true',
};

// Disable problematic feature and redeploy
VITE_FEATURE_LIVENESS=false npm run build
```

---

## Security Hardening

### 1. HTTPS & HSTS

Ensure your deployment uses HTTPS with HSTS:

```
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

### 2. Rate Limiting at Edge (Cloudflare/CDN)

```
# Example Cloudflare rule:
(cf.colo = SFO) and (http.request.uri.path contains "/api/attendance") and (cf.threat_score > 20)
→ Challenge (CAPTCHA)
```

### 3. Secrets Rotation

- Rotate `BIOMETRIC_ENC_KEY` and `LIVENESS_HMAC_KEY` every 90 days
- (Future enhancement: Key versioning with multi-key support)

### 4. Audit Logging

- Enable Supabase audit logs (if available in your plan)
- Set up external audit sink to immutable storage (e.g., S3 + Object Lock)

---

## Support & Escalation

For deployment issues:

1. **Check error logs:**
   - Browser console (F12 → Console tab)
   - Supabase dashboard (Logs → Edge Functions)
   - Sentry dashboard (if enabled)

2. **Enable verbose logging** (temporarily):

   ```typescript
   localStorage.setItem("debug", "*"); // Enable all debug logs
   ```

3. **Contact Support:**
   - Supabase: [supabase.com/support](https://supabase.com/support)
   - Resend: [resend.com/docs](https://resend.com/docs)
   - Cloud provider support (Vercel/AWS/GCP)

---

## Additional Resources

- [Supabase Documentation](https://supabase.com/docs)
- [TanStack Start Docs](https://tanstack.com/start)
- [Vite Deployment Guide](https://vitejs.dev/guide/static-deploy.html)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)

---

**Last Updated:** July 22, 2026  
**Maintained By:** [Team Name]  
**Version:** 1.0.0
