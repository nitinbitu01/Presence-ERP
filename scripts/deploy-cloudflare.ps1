# Presence ERP — Cloudflare Production Deploy Script
# Run this after substituting ANON_KEY below



$env:CLOUDFLARE_API_TOKEN = $CF_TOKEN
$config = ".output/server/wrangler.json"

Write-Host "Setting Cloudflare Worker secrets..." -ForegroundColor Cyan

$secrets = @{
    "SUPABASE_URL"              = $SUPABASE_URL
    "VITE_SUPABASE_URL"         = $SUPABASE_URL
    "SUPABASE_PROJECT_ID"       = $SUPABASE_PROJECT
    "VITE_SUPABASE_PROJECT_ID"  = $SUPABASE_PROJECT
    "SUPABASE_SERVICE_ROLE_KEY" = $SUPABASE_SERVICE_KEY
    "SUPABASE_PUBLISHABLE_KEY"  = $ANON_KEY
    "VITE_SUPABASE_PUBLISHABLE_KEY" = $ANON_KEY
    "BIOMETRIC_ENC_KEY"         = $BIOMETRIC_ENC_KEY
    "LIVENESS_HMAC_KEY"         = $LIVENESS_HMAC_KEY
    "OPENAI_API_KEY"            = $OPENAI_API_KEY
}

foreach ($name in $secrets.Keys) {
    $value = $secrets[$name]
    Write-Host "  Setting $name..." -NoNewline
    $value | npx wrangler secret put $name --config $config
    Write-Host " done" -ForegroundColor Green
}

Write-Host "`nDeploying to Cloudflare Workers..." -ForegroundColor Cyan
npx wrangler deploy --config $config

Write-Host "`nDone! App is live at https://presence-erp.workers.dev" -ForegroundColor Green
