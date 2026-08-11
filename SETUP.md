# Rashtriya Raksha University (RRU) — Presence ERP Setup Guide

This guide explains how to set up, initialize, and deploy the Presence Academic ERP for Rashtriya Raksha University.

---

## Step 1: Database Initialization (Supabase)

1. **Log in to Supabase**:
   Open [https://supabase.com](https://supabase.com) and log in with your administrator account.

2. **Database Migrations**:
   Run the database migration scripts in order using the Supabase CLI:

   ```bash
   npx supabase db push
   ```

   _This applies all schema migrations (RLS policies, append-only ledgers, academic tables, gradebook, fees, HR)._

3. **Database Seeding**:
   Run the seed script in the Supabase SQL Editor or via CLI:
   ```bash
   npx supabase db execute --file ./supabase/seed.sql
   ```
   Or copy the contents of `supabase/seed.sql` into the **Supabase Dashboard → SQL Editor** and click **Run**.
   This seeds:
   - Institution record: **Rashtriya Raksha University**
   - 5 Departments (`SITA`, `SISDP`, `SISSP`, `SICSR`, `SCBS`)
   - 4 Programs (`BTECH-CS`, `MTECH-CS`, `BA-SEC`, `MSC-CRIM`)
   - Active Semester (`2026-FALL`)

---

## Step 2: Environment Variables & Secrets

In your deployment platform (Cloudflare Pages / Vercel / Netlify) or local `.env` file, configure the following environment variables:

### Required Secrets

| Variable Name               | Purpose                                                   | Example Value                      |
| --------------------------- | --------------------------------------------------------- | ---------------------------------- |
| `VITE_SUPABASE_URL`         | Supabase API URL                                          | `https://your-project.supabase.co` |
| `VITE_SUPABASE_ANON_KEY`    | Supabase Public Key                                       | `sb_publishable_...`               |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Admin Secret Key                                 | `sb_secret_...`                    |
| `BIOMETRIC_ENC_KEY`         | 32-byte secret key for AES-GCM face descriptor encryption | Random 32-char string              |
| `LIVENESS_HMAC_KEY`         | Secret key for signing 60-second liveness challenges      | Random 32-char string              |

### Optional Integrations (Safe to leave unset for initial pilot)

- `RESEND_API_KEY`: Email notification service (falls back to console logs if unset)
- `RAZORPAY_KEY_ID` & `RAZORPAY_KEY_SECRET`: Fee payments (falls back to test mode/manual recording if unset)
- `ALERT_WEBHOOK_URL`: Slack/Discord security alert webhook (falls back to console logs if unset)

---

## Step 3: Deployment

### Deploying to Cloudflare Workers / Pages

Build the production bundle:

```bash
npm run build
```

Deploy the prebuilt Nitro server:

```bash
npx wrangler deploy
```

---

## Step 4: Claiming the First Administrator Account

1. Open the deployed application URL in your browser (e.g. `https://rru-presence.pages.dev/auth`).
2. Register a new user account with your official RRU email address.
3. Sign in to the app and navigate to `/admin`.
4. Click **"Claim Administrator Role"**.
   - _Note: The first user to claim the admin role becomes the primary administrator. Subsequent admin assignments must be explicitly granted by an existing admin._
5. The admin console will immediately populate with the seeded RRU departments, programs, and active semester.

---

## Technical Support

For setup assistance or queries regarding security policies, contact the system administrator or refer to `HANDOVER.md`.
