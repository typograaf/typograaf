import { Dropbox } from 'dropbox'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const path = request.nextUrl.searchParams.get('path')
  const accessToken = process.env.DROPBOX_ACCESS_TOKEN

  if (!accessToken) {
    return NextResponse.json({ error: 'Not configured' }, { status: 500 })
  }

  if (!path) {
    return NextResponse.json({ error: 'Path required' }, { status: 400 })
  }

  try {
    const dbx = new Dropbox({ accessToken, fetch })
    const linkResponse = await dbx.filesGetTemporaryLink({ path })
    return NextResponse.json({ url: linkResponse.result.link })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to get link'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
