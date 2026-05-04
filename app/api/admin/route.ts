import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import {
  getAboutText,
  saveAboutText,
  saveProjectOrderOverride,
} from '../../../lib/cms'
import { getProjectOrder, getManifest, deleteImage } from '../../../lib/sync'

export const dynamic = 'force-dynamic'

async function isAuthed() {
  const c = await cookies()
  return c.get('auth')?.value === '1'
}

export async function GET() {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const folderPath = (process.env.DROPBOX_FOLDER_PATH || '').toLowerCase()
  const baseDepth = folderPath.split('/').length
  const [order, about, manifest] = await Promise.all([
    getProjectOrder(),
    getAboutText(),
    getManifest(),
  ])
  const images = manifest.map(img => {
    const parts = img.path.split('/')
    const project = parts[baseDepth] || ''
    return { id: img.id, name: img.name, url: img.blobUrl, project }
  })
  return NextResponse.json({ order, about, images })
}

export async function POST(request: NextRequest) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const body = await request.json().catch(() => ({}))

  if (Array.isArray(body.order)) {
    const cleaned = body.order
      .filter((p: unknown): p is string => typeof p === 'string')
      .map((p: string) => p.trim())
      .filter(Boolean)
    await saveProjectOrderOverride(cleaned)
  }
  if (typeof body.about === 'string') {
    await saveAboutText(body.about)
  }

  revalidatePath('/about')
  revalidatePath('/')
  revalidatePath('/work')

  return NextResponse.json({ ok: true })
}

export async function DELETE(request: NextRequest) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const body = await request.json().catch(() => ({}))
  const id = typeof body?.id === 'string' ? body.id : ''
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 })

  try {
    const result = await deleteImage(id)
    revalidatePath('/')
    revalidatePath('/work')
    return NextResponse.json({ ok: result.deleted })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'delete failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
