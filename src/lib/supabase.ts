// src/lib/supabaseClient.ts
import { createClient } from "@supabase/supabase-js";
import { env } from "../env";

// ここで最低限のガード（main.tsx 以外から import されても安全）
if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
  throw new Error("Missing Supabase env. Check VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.");
}

export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
