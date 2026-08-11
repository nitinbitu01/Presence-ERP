import { createClient } from "@supabase/supabase-js";

const url = "https://kdqcfhhaffsbhnmvrjmt.supabase.co";
const key = "sb_publishable_qtBzgk_bEgNdMMlcbcaLxA_F-Eul3bW";

const supabase = createClient(url, key);

async function main() {
  const email = "nitinbitu03@gmail.com";
  const password = "Nitinyadav#2006";

  console.log("Attempting sign in for admin:", email);
  let { data: authData, error: signInErr } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (signInErr) {
    console.log("Sign in failed:", signInErr.message, "— attempting sign up...");
    const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: "Nitin Yadav (Admin)" },
      },
    });
    if (signUpErr) {
      console.error("Sign up error:", signUpErr.message);
      return;
    }
    authData = signUpData;
    console.log("Signed up user ID:", authData.user?.id);
  } else {
    console.log("Signed in user ID:", authData.user?.id);
  }

  const token = authData.session?.access_token;
  if (!token) {
    console.log(
      "No session access token returned (may require email confirmation if email confirmation is enabled on Supabase).",
    );
    return;
  }

  const authedClient = createClient(url, key, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });

  // Check roles
  const { data: roles, error: rolesErr } = await authedClient.from("user_roles").select("*");
  console.log("Current user_roles:", roles, "Error:", rolesErr?.message);

  // Check if bootstrap admin can be claimed or role inserted
  const { data: existingAdmin } = await authedClient
    .from("user_roles")
    .select("*")
    .eq("role", "admin");

  console.log("Existing admins count:", existingAdmin?.length);

  if (!existingAdmin || existingAdmin.length === 0) {
    console.log("Claiming admin role...");
    const { error: insErr } = await authedClient
      .from("user_roles")
      .insert({ user_id: authData.user.id, role: "admin" });
    console.log("Insert admin result error:", insErr?.message);
  }
}

main().catch(console.error);
