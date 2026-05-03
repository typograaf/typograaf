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
        {/* Pre-paint: if the URL has ?from=menu, set a data attribute on
            <html> so the CSS folder-close animation runs before React
            hydrates. Use a data attribute (not a className) because React
            owns <html>'s className during hydration and would strip a
            client-added one — data-* attrs are left alone. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){if(location.search.indexOf('from=menu')===-1)return;document.documentElement.setAttribute('data-from-menu','1');var u=new URL(location.href);u.searchParams.delete('from');history.replaceState({},'',u.pathname+(u.search||'')+u.hash);})();`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
