import { createBrowserClient } from '@supabase/ssr'
import { getSupabasePublicKey, getSupabaseUrl, isSupabaseConfigured } from '@/lib/supabaseEnv'

const supabaseUrl = getSupabaseUrl()
const publicKey = getSupabasePublicKey()

// Allow local UI preview even when env vars aren't set yet.
export const supabaseBrowser =
  isSupabaseConfigured() && supabaseUrl && publicKey
    ? createBrowserClient(supabaseUrl, publicKey)
    : null

