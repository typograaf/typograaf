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
        {/* Pre-paint: tag <html> if we arrived via ?from=menu so the CSS
            folder-close animation runs before React hydrates. Avoids
            the SSR/CSR state mismatch that would otherwise flicker. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){if(location.search.indexOf('from=menu')===-1)return;document.documentElement.classList.add('from-menu');var u=new URL(location.href);u.searchParams.delete('from');history.replaceState({},'',u.pathname+(u.search||'')+u.hash);})();`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
