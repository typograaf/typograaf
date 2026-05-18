import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import {
  getAboutText,
  saveAboutText,
  saveProjectOrderOverride,
  getHiddenImageIds,
  saveHiddenImageIds,
  getQuotes,
  saveQuotes,
} from '../../../lib/cms'
import { getProjectOrder, getManifest, deleteImage } from '../../../lib/sync'
import type { Quote } from '../../../lib/quote'

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
  const [order, about, manifest, hiddenIds, quotes] = await Promise.all([
    getProjectOrder(),
    getAboutText(),
    getManifest(),
    getHiddenImageIds(),
    getQuotes(),
  ])
  const hidden = new Set(hiddenIds)
  const images = manifest.map(img => {
    const parts = img.path.split('/')
    const project = parts[baseDepth] || ''
    return {
      id: img.id,
      name: img.name,
      url: img.blobUrl,
      project,
      hidden: hidden.has(img.id),
    }
  })
  return NextResponse.json({ order, about, images, quotes })
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
  if (Array.isArray(body.quotes)) {
    const prev = await getQuotes()
    await saveQuotes(body.quotes as Quote[])
    const slugs = new Set<string>()
    for (const q of body.quotes as Quote[]) {
      if (q && typeof q.slug === 'string' && q.slug) slugs.add(q.slug)
    }
    for (const q of prev) slugs.add(q.slug)
    for (const slug of slugs) revalidatePath(`/quote/${slug}`)
  }

  revalidatePath('/about')
  revalidatePath('/')
  revalidatePath('/work')

  return NextResponse.json({ ok: true })
}

export async function PATCH(request: NextRequest) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const body = await request.json().catch(() => ({}))
  const id = typeof body?.id === 'string' ? body.id : ''
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 })
  if (typeof body?.hidden !== 'boolean') {
    return NextResponse.json({ error: 'missing hidden flag' }, { status: 400 })
  }

  const current = await getHiddenImageIds()
  const set = new Set(current)
  if (body.hidden) set.add(id)
  else set.delete(id)
  await saveHiddenImageIds(Array.from(set))

  revalidatePath('/')
  revalidatePath('/work')
  return NextResponse.json({ ok: true, hidden: body.hidden })
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
