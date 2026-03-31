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
      setAll: async (cookiesToSet) => {
        try {
          const cookieStore = await cookies()
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // Server Components / read-only contexts: session refresh may be handled by middleware.
        }
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

