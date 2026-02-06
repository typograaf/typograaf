import { Dropbox } from 'dropbox'
import { NextRequest, NextResponse } from 'next/server'

async function getAccessToken() {
  const refreshToken = process.env.DROPBOX_REFRESH_TOKEN
  const appKey = process.env.DROPBOX_APP_KEY
  const appSecret = process.env.DROPBOX_APP_SECRET

  if (!refreshToken || !appKey || !appSecret) {
    throw new Error('Dropbox credentials not configured')
  }

  const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: appKey,
      client_secret: appSecret,
    }),
  })

  const data = await response.json()
  if (!data.access_token) throw new Error('Failed to refresh token')
  return data.access_token
}

export async function GET(request: NextRequest) {
  const cookies = request.headers.get('cookie') || ''
  if (!cookies.includes('auth=1')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const path = request.nextUrl.searchParams.get('path')

  if (!path) {
    return NextResponse.json({ error: 'Path required' }, { status: 400 })
  }

  try {
    const accessToken = await getAccessToken()
    const dbx = new Dropbox({ accessToken, fetch })
    const linkResponse = await dbx.filesGetTemporaryLink({ path })
    return NextResponse.json({ url: linkResponse.result.link })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to get link'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
