import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { getSupabasePublicKey, getSupabaseUrl, isSupabaseConfigured } from '@/lib/supabaseEnv'

/**
 * Creates a Supabase server client bound to the current middleware request/response cookies.
 * This is the recommended way to avoid random logouts in Supabase SSR.
 */
export function createMiddlewareSupabaseClient(req: NextRequest, res: NextResponse) {
  if (!isSupabaseConfigured()) return null

  const supabaseUrl = getSupabaseUrl()!
  const publicKey = getSupabasePublicKey()!

  return createServerClient(supabaseUrl, publicKey, {
    cookies: {
      getAll: () => req.cookies.getAll().map((c) => ({ name: c.name, value: c.value })),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value, options }) => {
          res.cookies.set(name, value, options)
        })
      },
    },
  })
}

