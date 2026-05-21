import { NextRequest, NextResponse } from 'next/server'

// Same-origin proxy for font files stored in R2. Serving fonts from our own
// origin avoids the cross-origin CORS requirement that @font-face enforces,
// and lets the type-tester fetch the raw bytes (for variable-axis parsing)
// without a CORS preflight.

export const dynamic = 'force-dynamic'

const PUBLIC_URL = process.env.R2_PUBLIC_URL || ''

const MIME: Record<string, string> = {
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
  otf: 'font/otf',
}

// Only ever proxy font objects from our own image prefix — never an
// arbitrary key.
const KEY_RE = /^images\/[A-Za-z0-9_.-]+\.(woff2|woff|ttf|otf)$/

export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get('key') || ''
  const match = key.match(KEY_RE)
  if (!match) {
    return NextResponse.json({ error: 'Invalid key' }, { status: 400 })
  }
  if (!PUBLIC_URL) {
    return NextResponse.json({ error: 'Not configured' }, { status: 500 })
  }

  const upstream = await fetch(`${PUBLIC_URL}/${key}`)
  if (!upstream.ok) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const body = await upstream.arrayBuffer()
  return new Response(body, {
    headers: {
      'Content-Type': MIME[match[1]] || 'application/octet-stream',
      // Font objects are content-addressed by Dropbox file id, so they're
      // safe to cache permanently.
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}
