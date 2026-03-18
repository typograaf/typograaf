import { createHmac } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { syncWithDropbox } from '../../../lib/sync'

// Dropbox sends a GET with ?challenge= to verify the endpoint
export async function GET(request: NextRequest) {
  const challenge = request.nextUrl.searchParams.get('challenge')
  if (challenge) {
    return new Response(challenge, {
      headers: { 'Content-Type': 'text/plain', 'X-Content-Type-Options': 'nosniff' },
    })
  }

  // Manual init: /api/sync?init=true&secret=...
  const init = request.nextUrl.searchParams.get('init')
  const secret = request.nextUrl.searchParams.get('secret')
  if (init === 'true') {
    if (secret !== process.env.DROPBOX_APP_SECRET) {
      return NextResponse.json({ error: 'Invalid secret' }, { status: 401 })
    }
    const result = await syncWithDropbox()
    return NextResponse.json({ ok: true, ...result })
  }

  return NextResponse.json({ error: 'Bad request' }, { status: 400 })
}

// Dropbox calls this POST whenever files change in the watched folder
export async function POST(request: NextRequest) {
  const appSecret = process.env.DROPBOX_APP_SECRET
  if (!appSecret) return NextResponse.json({ error: 'Not configured' }, { status: 500 })

  const body = await request.text()
  const signature = request.headers.get('x-dropbox-signature') || ''
  const expected = createHmac('sha256', appSecret).update(body).digest('hex')

  if (signature !== expected) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
  }

  // Respond immediately, sync in background
  waitUntil(syncWithDropbox())
  return NextResponse.json({ ok: true })
}
