import { NextRequest, NextResponse } from 'next/server'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { isAuthed } from '../../../../lib/adminAuth'
import { getS3Client, BUCKET } from '../../../../lib/sync'

export const dynamic = 'force-dynamic'

const MAX_BYTES = 4 * 1024 * 1024
const PUBLIC_URL = process.env.R2_PUBLIC_URL || ''

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
  svg: 'image/svg+xml',
}

function extFromName(name: string): string {
  const m = /\.([a-zA-Z0-9]+)$/.exec(name)
  return m ? m[1].toLowerCase() : ''
}

function monthKey(): string {
  const d = new Date()
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`
}

export async function POST(request: NextRequest) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'invalid form' }, { status: 400 })
  }
  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'missing file' }, { status: 400 })
  }
  if (!file.type.startsWith('image/')) {
    return NextResponse.json({ error: 'not an image' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'too large (max 4 MB)' }, { status: 413 })
  }
  const ext = extFromName(file.name) || (file.type.split('/')[1] || '')
  if (!EXT_MIME[ext]) {
    return NextResponse.json({ error: 'unsupported file type' }, { status: 400 })
  }
  const key = `quotes/${monthKey()}/${crypto.randomUUID()}.${ext}`
  const body = new Uint8Array(await file.arrayBuffer())
  try {
    const s3 = getS3Client()
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: EXT_MIME[ext],
    }))
  } catch (err) {
    const message = err instanceof Error ? err.message : 'upload failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
  return NextResponse.json({ url: `${PUBLIC_URL}/${key}` })
}
