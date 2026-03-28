import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { getSupabasePublicKey, getSupabaseUrl, isSupabaseConfigured, missingSupabaseEnvMessage } from '@/lib/supabaseEnv'

export function supabaseServerClientOrNull() {
  if (!isSupabaseConfigured()) return null

  const supabaseUrl = getSupabaseUrl()!
  const publicKey = getSupabasePublicKey()!

  return createServerClient(supabaseUrl, publicKey, {
    cookies: {
      getAll: async () => {
        const cookieStore = await cookies()
        return cookieStore.getAll().map((c) => ({ name: c.name, value: c.value }))
      },
    },
  })
}

export function supabaseServerClient() {
  const client = supabaseServerClientOrNull()
  if (!client) {
    throw new Error(missingSupabaseEnvMessage())
  }
  return client
}

