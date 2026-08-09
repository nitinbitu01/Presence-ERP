import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://omewkcnzhgptspgljrnc.supabase.co";
const SUPABASE_SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tZXdrY256aGdwdHNwZ2xqcm5jIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTgzMzM0MywiZXhwIjoyMTAxNDA5MzQzfQ.jyYlQi2afwr3SLEAKor1uCp-dj2M2mV52lGZSVohjzQ";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
  console.log("Seeding sso_providers in Supabase database...");

  const providers = [
    {
      id: 'azure_ad_rru',
      name: 'Rashtriya Raksha University (Azure AD)',
      type: 'azure_ad',
      protocol: 'oidc',
      enabled: true,
      domains: ["rru.ac.in", "rashtriyaraksha.ac.in"],
      issuer_url: 'https://login.microsoftonline.com/rru.ac.in/v2.0',
      sso_url: 'https://login.microsoftonline.com/rru.ac.in/oauth2/v2.0/authorize',
      client_id: 'client_rru_presence_erp_123',
      attribute_mapping: {
        email: "preferred_username",
        displayName: "name",
        rollNo: "employeeId",
        department: "department",
        groups: "groups"
      },
      group_role_mapping: {
        "RRU-Faculty-Group": "teacher",
        "RRU-Admin-Group": "admin",
        "RRU-Student-Group": "student"
      },
      tenant_id: 'rru-main',
      updated_at: new Date().toISOString()
    },
    {
      id: 'shibboleth_iit',
      name: 'Institutional Federation (Shibboleth SAML 2.0)',
      type: 'shibboleth',
      protocol: 'saml2',
      enabled: true,
      domains: ["institution.edu"],
      sso_url: 'https://idp.institution.edu/idp/profile/SAML2/Redirect/SSO',
      attribute_mapping: {
        email: "urn:oid:0.9.2342.19200300.100.1.3",
        displayName: "urn:oid:2.5.4.3",
        rollNo: "urn:oid:1.3.6.1.4.1.5923.1.1.1.6"
      },
      group_role_mapping: {},
      tenant_id: 'rru-main',
      updated_at: new Date().toISOString()
    }
  ];

  const { error } = await supabase.from('sso_providers').upsert(providers);

  if (error) {
    console.error("Error inserting sso_providers:", error.message);
  } else {
    console.log("✓ Successfully seeded sso_providers table in Supabase!");
  }
}

main().catch(console.error);
