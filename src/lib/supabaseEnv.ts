/**
 * Resolves Supabase URL + public client key from env.
 * Supports the legacy JWT anon key and the newer publishable key (`sb_publishable_...`).
 * @see https://supabase.com/docs/guides/api/api-keys
 */
export function getSupabaseUrl(): string | undefined {
  const v = process.env.NEXT_PUBLIC_SUPABASE_URL
  return v?.trim() || undefined
}

/**
 * Public key for browser/server clients: legacy `anon` JWT or new publishable key.
 */
export function getSupabasePublicKey(): string | undefined {
  const v =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY
  return v?.trim() || undefined
}

export function isSupabaseConfigured(): boolean {
  return Boolean(getSupabaseUrl() && getSupabasePublicKey())
}

export function missingSupabaseEnvMessage() {
  return (
    'Configure Supabase: set NEXT_PUBLIC_SUPABASE_URL and a public key ' +
    '(NEXT_PUBLIC_SUPABASE_ANON_KEY or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY).'
  )
}
