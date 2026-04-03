import type { ReactNode } from 'react'
import '@/styles/nr-brand-logo.css'
import './sign-in-reference.css'

export default function LoginLayout({ children }: { children: ReactNode }) {
  return <div id="sign-in-reference-root">{children}</div>
}
