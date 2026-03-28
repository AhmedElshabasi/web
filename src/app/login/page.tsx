import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { supabaseServerClientOrNull } from '@/lib/supabaseServer'
import { PlatformAuthClient } from './PlatformAuthClient'

export const dynamic = 'force-dynamic'

export default async function LoginPage() {
  const supabase = supabaseServerClientOrNull()
  const user = supabase ? (await supabase.auth.getUser()).data.user : null

  if (user) redirect('/receive')

  return (
    <Suspense fallback={<div className="screen login-screen" style={{ background: '#1c1c1e' }} />}>
      <PlatformAuthClient supabaseConfigured={Boolean(supabase)} />
    </Suspense>
  )
}
