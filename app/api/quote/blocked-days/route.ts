import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { getBlockedDays, saveBlockedDays } from '../../../../lib/cms'

export const dynamic = 'force-dynamic'

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function authed(request: NextRequest): boolean {
  const expected = process.env.QUOTE_API_TOKEN
  if (!expected) return false
  const auth = request.headers.get('authorization') || ''
  const m = /^Bearer\s+(.+)$/.exec(auth)
  return !!m && constantTimeEqual(m[1], expected)
}

export async function GET(request: NextRequest) {
  if (!authed(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const days = await getBlockedDays()
  return NextResponse.json({ days })
}

export async function POST(request: NextRequest) {
  if (!authed(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const body = await request.json().catch(() => null) as { days?: unknown } | null
  if (!body || !Array.isArray(body.days)) {
    return NextResponse.json({ error: 'expected { days: string[] }' }, { status: 400 })
  }
  const days = body.days.filter((s: unknown): s is string => typeof s === 'string')
  await saveBlockedDays(days)
  // Quote pages are force-dynamic, but bust just in case any wrapper caches.
  revalidatePath('/quote/[name]', 'page')
  return NextResponse.json({ ok: true, count: days.length })
}
