-- Migration: Create sso_providers table for database-backed SSO IdP persistence
CREATE TABLE IF NOT EXISTS public.sso_providers (
  id text PRIMARY KEY,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('azure_ad', 'shibboleth', 'okta', 'google_workspace', 'custom_saml')),
  protocol text NOT NULL CHECK (protocol IN ('saml2', 'oidc')),
  enabled boolean NOT NULL DEFAULT true,
  domains jsonb NOT NULL DEFAULT '[]'::jsonb,
  entity_id text,
  sso_url text,
  issuer_url text,
  client_id text,
  client_secret_ciphertext text,
  certificate_pem text,
  attribute_mapping jsonb NOT NULL DEFAULT '{"email": "email", "displayName": "name"}'::jsonb,
  group_role_mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  tenant_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sso_providers TO authenticated;
GRANT ALL ON public.sso_providers TO service_role;

ALTER TABLE public.sso_providers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all_sso_providers" ON public.sso_providers;
CREATE POLICY "admin_all_sso_providers" ON public.sso_providers
  FOR ALL TO authenticated
  USING (private.has_role('admin'));

-- Seed default enterprise SSO providers
INSERT INTO public.sso_providers (id, name, type, protocol, enabled, domains, issuer_url, sso_url, client_id, attribute_mapping, group_role_mapping, tenant_id)
VALUES (
  'azure_ad_rru',
  'Rashtriya Raksha University (Azure AD)',
  'azure_ad',
  'oidc',
  true,
  '["rru.ac.in", "rashtriyaraksha.ac.in"]'::jsonb,
  'https://login.microsoftonline.com/rru.ac.in/v2.0',
  'https://login.microsoftonline.com/rru.ac.in/oauth2/v2.0/authorize',
  'client_rru_presence_erp_123',
  '{"email": "preferred_username", "displayName": "name", "rollNo": "employeeId", "department": "department", "groups": "groups"}'::jsonb,
  '{"RRU-Faculty-Group": "teacher", "RRU-Admin-Group": "admin", "RRU-Student-Group": "student"}'::jsonb,
  'rru-main'
),
(
  'shibboleth_iit',
  'Institutional Federation (Shibboleth SAML 2.0)',
  'shibboleth',
  'saml2',
  true,
  '["institution.edu"]'::jsonb,
  NULL,
  'https://idp.institution.edu/idp/profile/SAML2/Redirect/SSO',
  NULL,
  '{"email": "urn:oid:0.9.2342.19200300.100.1.3", "displayName": "urn:oid:2.5.4.3", "rollNo": "urn:oid:1.3.6.1.4.1.5923.1.1.1.6"}'::jsonb,
  '{}'::jsonb,
  'rru-main'
)
ON CONFLICT (id) DO NOTHING;
