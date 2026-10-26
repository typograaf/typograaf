import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { waitUntil } from '@vercel/functions'
import { isAuthed } from '../../../lib/adminAuth'
import {
  getAboutText,
  saveAboutText,
  saveProjectOrderOverride,
  getHiddenImageIds,
  saveHiddenImageIds,
  getPortfolioImageIds,
  savePortfolioImageIds,
  getQuotes,
  saveQuotes,
  getSentences,
  saveSentences,
  getPreviewAxes,
  savePreviewAxes,
  getBlockedDays,
  getHiddenImageIdsStrict,
} from '../../../lib/cms'
import { getProjectOrder, getManifest, deleteImage, orderedVisible } from '../../../lib/sync'
import { reconcileArena } from '../../../lib/arena'
import { isFontFile, buildTiles } from '../../../lib/tiles'
import type { Quote } from '../../../lib/quote'

export const dynamic = 'force-dynamic'

// The Are.na board is an ordered mirror of the site, so a new project order
// has to be pushed to it too. Only acts on a hidden-image list it actually
// read: a failed read must never put hidden images back on the board.
async function mirrorOrderToArena(): Promise<void> {
  const [manifest, projectOrder, hidden] = await Promise.all([
    getManifest(),
    getProjectOrder(),
    getHiddenImageIdsStrict(),
  ])
  if (hidden === null) {
    console.warn('arena: skipped after order save, could not read the hidden-image list')
    return
  }
  await reconcileArena(
    orderedVisible(manifest, projectOrder, hidden).filter(e => !isFontFile(e.name)),
  )
}

export async function GET() {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const folderPath = (process.env.DROPBOX_FOLDER_PATH || '').toLowerCase()
  const baseDepth = folderPath.split('/').length
  const [order, about, manifest, hiddenIds, quotes, sentences, previewAxes, blockedDays, portfolioIds] = await Promise.all([
    getProjectOrder(),
    getAboutText(),
    getManifest(),
    getHiddenImageIds(),
    getQuotes(),
    getSentences(),
    getPreviewAxes(),
    getBlockedDays(),
    getPortfolioImageIds(),
  ])
  const hidden = new Set(hiddenIds)
  const inPortfolio = new Set(portfolioIds)
  const images = manifest.map(img => {
    const parts = img.path.split('/')
    const project = parts[baseDepth] || ''
    return {
      id: img.id,
      name: img.name,
      url: img.blobUrl,
      project,
      hidden: hidden.has(img.id),
      portfolio: inPortfolio.has(img.id),
      isFont: isFontFile(img.name),
    }
  })
  // Typefaces (grouped font tiles) so the admin can set default axes per
  // font; url lets the admin load the font to preview it and read its axes.
  const fonts = buildTiles(orderedVisible(manifest, order, []))
    .filter((t): t is Extract<typeof t, { kind: 'font' }> => t.kind === 'font')
    .map(t => ({ id: t.id, name: t.name, url: t.styles[0]?.url || '' }))
  return NextResponse.json({ order, about, images, quotes, sentences, fonts, previewAxes, blockedDays })
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
    // Re-sort the board in the background so Save returns at once; a full
    // re-sort can take a minute of paced Are.na moves.
    waitUntil(mirrorOrderToArena())
  }
  if (typeof body.about === 'string') {
    await saveAboutText(body.about)
  }
  if (Array.isArray(body.sentences)) {
    await saveSentences(
      body.sentences.filter((s: unknown): s is string => typeof s === 'string'),
    )
  }
  if (body.previewAxes && typeof body.previewAxes === 'object') {
    await savePreviewAxes(body.previewAxes as Record<string, Record<string, number>>)
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
  revalidatePath('/portfolio')

  return NextResponse.json({ ok: true })
}

export async function PATCH(request: NextRequest) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const body = await request.json().catch(() => ({}))
  const id = typeof body?.id === 'string' ? body.id : ''
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 })

  // Portfolio membership: its own list, independent of the hidden list and
  // never mirrored to Are.na.
  if (typeof body?.portfolio === 'boolean') {
    const set = new Set(await getPortfolioImageIds())
    if (body.portfolio) set.add(id)
    else set.delete(id)
    await savePortfolioImageIds(Array.from(set))
    revalidatePath('/portfolio')
    return NextResponse.json({ ok: true, portfolio: body.portfolio })
  }

  if (typeof body?.hidden !== 'boolean') {
    return NextResponse.json({ error: 'missing hidden or portfolio flag' }, { status: 400 })
  }

  const current = await getHiddenImageIds()
  const set = new Set(current)
  if (body.hidden) set.add(id)
  else set.delete(id)
  const nextHidden = Array.from(set)
  await saveHiddenImageIds(nextHidden)

  // Keep Are.na in step: hiding removes the block, unhiding re-adds it.
  // Fonts are never mirrored to Are.na.
  const [manifest, projectOrder] = await Promise.all([getManifest(), getProjectOrder()])
  await reconcileArena(
    orderedVisible(manifest, projectOrder, nextHidden).filter(e => !isFontFile(e.name)),
  )

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
