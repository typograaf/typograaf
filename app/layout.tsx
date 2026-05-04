import { Suspense } from 'react'
import './globals.css'
import LayoutShell from './LayoutShell'

export const metadata = {
  title: 'Typografie',
  description: 'A visual portfolio',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://dl.dropboxusercontent.com" />
        <link rel="dns-prefetch" href="https://dl.dropboxusercontent.com" />
      </head>
      <body>
        {/* Suspense wrapper because LayoutShell uses useSearchParams. */}
        <Suspense>
          <LayoutShell>{children}</LayoutShell>
        </Suspense>
      </body>
    </html>
  )
}
