import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { getQuotes, saveQuotes } from '../../../../lib/cms'
import { normalizeQuote, type Quote } from '../../../../lib/quote'

export const dynamic = 'force-dynamic'

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function POST(request: NextRequest) {
  const expected = process.env.QUOTE_API_TOKEN
  if (!expected) {
    return NextResponse.json({ error: 'not configured' }, { status: 503 })
  }
  const auth = request.headers.get('authorization') || ''
  const m = /^Bearer\s+(.+)$/.exec(auth)
  if (!m || !constantTimeEqual(m[1], expected)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null) as { quote?: unknown } | null
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }
  const normalized = normalizeQuote(body.quote)
  if (!normalized) {
    return NextResponse.json({ error: 'invalid quote (need project name or slug)' }, { status: 400 })
  }

  const existing = await getQuotes()
  // Replace any existing quote with the same slug; otherwise append.
  const filtered = existing.filter((q) => q.slug !== normalized.slug)
  const next: Quote[] = [...filtered, normalized]
  await saveQuotes(next)
  revalidatePath(`/quote/${normalized.slug}`)

  return NextResponse.json({
    ok: true,
    slug: normalized.slug,
    url: `https://typografie.be/quote/${normalized.slug}`,
    replaced: filtered.length !== existing.length,
  })
}
