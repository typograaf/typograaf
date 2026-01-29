import { NextRequest, NextResponse } from 'next/server'

// Cache thumbnails for 1 hour
export const revalidate = 3600

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
  const path = request.nextUrl.searchParams.get('path')

  if (!path) {
    return NextResponse.json({ error: 'Path required' }, { status: 400 })
  }

  try {
    const accessToken = await getAccessToken()

    // Get thumbnail from Dropbox (w256h256 is a good size for grid)
    const response = await fetch('https://content.dropboxapi.com/2/files/get_thumbnail_v2', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Dropbox-API-Arg': JSON.stringify({
          resource: { '.tag': 'path', path },
          format: { '.tag': 'jpeg' },
          size: { '.tag': 'w256h256' },
          mode: { '.tag': 'strict' }
        })
      }
    })

    if (!response.ok) {
      throw new Error('Failed to get thumbnail')
    }

    const imageBuffer = await response.arrayBuffer()

    return new NextResponse(imageBuffer, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=7200',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get thumbnail'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
