import './globals.css'

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
      <body>{children}</body>
    </html>
  )
}
