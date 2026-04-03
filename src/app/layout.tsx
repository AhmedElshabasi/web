import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'NoRedundancy',
  description: 'AI-powered Report Insights',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
