import type { ReactNode } from 'react'
import './platform-auth.css'

export default function LoginLayout({ children }: { children: ReactNode }) {
  return <div className="nr-auth-scope">{children}</div>
}
