import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canSetPassword } from "@/lib/auth/invite-accept";

// True only for a verified session whose amr shows an emailed link opened in the last
// minutes. getClaims verifies the access token (signature or Auth server) before use.
export async function mayChangePassword(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data) return false;
  return canSetPassword(data.claims.amr, Math.floor(Date.now() / 1000));
}
