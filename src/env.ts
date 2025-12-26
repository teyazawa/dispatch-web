// src/env.ts
export const env = {
  API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
  SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
} as const;

export function assertEnv() {
  const missing = Object.entries(env).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    // “silent fail” を避ける：誤API呼び出しやKintone誤更新も止められる
    throw new Error(`Missing env: ${missing.join(", ")}`);
  }
}
