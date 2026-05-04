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
        {/* Pre-paint: tag <html> with data-from-menu if the URL has
            ?from=menu so the CSS folder-close animation runs before
            React hydrates. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){if(location.search.indexOf('from=menu')===-1)return;document.documentElement.setAttribute('data-from-menu','1');var u=new URL(location.href);u.searchParams.delete('from');history.replaceState({},'',u.pathname+(u.search||'')+u.hash);})();`,
          }}
        />
      </head>
      <body>
        <LayoutShell>{children}</LayoutShell>
      </body>
    </html>
  )
}
