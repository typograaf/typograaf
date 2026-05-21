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
        {/* Logo layers — preloaded so the folder is visible in the very
            first paint, before React hydrates. */}
        <link rel="preload" as="image" href="/icon-back.png" fetchPriority="high" />
        <link rel="preload" as="image" href="/icon-middle.png" fetchPriority="high" />
        <link rel="preload" as="image" href="/icon-front.png" fetchPriority="high" />
        {/* Warm the connection to the R2 image CDN so the first image
            request doesn't pay the TLS handshake. */}
        <link rel="preconnect" href="https://pub-2fa2222db8464ea8ae4752194fbbfa2b.r2.dev" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://pub-2fa2222db8464ea8ae4752194fbbfa2b.r2.dev" />
        {/* Critical CSS — minimum needed for the first paint of the
            page background, font, and the persistent logo. The full
            stylesheet still loads after, but render isn't blocked on
            it. Keep this in sync with the matching rules in globals.css. */}
        <style dangerouslySetInnerHTML={{ __html: `
*{box-sizing:border-box;margin:0;padding:0;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
html{overflow:scroll;overflow-x:hidden;scrollbar-width:none;-ms-overflow-style:none}
html::-webkit-scrollbar{width:0;height:0;display:none;background:transparent}
body{background:#f8f8f8;min-height:100vh;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','SF Pro',system-ui,sans-serif;font-size:14px;font-weight:500;font-variation-settings:'wdth' 100;line-height:normal;color:#000;-webkit-font-smoothing:antialiased}
.logo{position:fixed;top:32px;left:32px;width:32px;height:31.6px;z-index:100;cursor:pointer;background:transparent;border:0;padding:0;display:block;-webkit-tap-highlight-color:transparent}
.logo-layer{position:absolute;left:0;width:100%;background-repeat:no-repeat;background-size:100% 100%;background-position:center;pointer-events:none;will-change:transform}
.logo-back{bottom:2.87px;height:28.7px;background-image:url(/icon-back.png)}
.logo-middle{bottom:2.87px;height:25.4px;background-image:url(/icon-middle.png)}
.logo-front{bottom:2.87px;height:21.4px;background-image:url(/icon-front.png)}
@media (max-width:900px){.logo{top:24px;left:24px}}
        `.trim() }} />
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
