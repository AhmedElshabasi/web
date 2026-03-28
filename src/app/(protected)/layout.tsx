import { redirect } from 'next/navigation'
import { supabaseServerClientOrNull } from '@/lib/supabaseServer'
import { MainPageShell } from '@/components/MainPageShell'
import './main-page-reference.css'

export const dynamic = 'force-dynamic'

export default async function ProtectedLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const supabase = supabaseServerClientOrNull()
  if (!supabase) redirect('/login?missing_env=1')

  const { data } = await supabase.auth.getUser()
  const user = data.user
  if (!user) redirect('/login')

  return <MainPageShell userEmail={user.email ?? null}>{children}</MainPageShell>
}
