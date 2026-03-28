import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'NoRedundancy — File Share',
  description: 'Secure file sharing',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
