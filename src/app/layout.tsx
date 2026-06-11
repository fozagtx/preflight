import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Release Preflight - Splunk Release Risk Agent',
  description:
    'Run Splunk-backed pre-deploy incident analysis before a risky release reaches production.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  )
}
