import { NextResponse } from 'next/server'
import { getManifest, getProjectOrder, orderedVisible } from '../../../lib/sync'
import { getHiddenImageIds, getSentences } from '../../../lib/cms'
import { buildTiles, isFontFile } from '../../../lib/tiles'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const [manifest, projectOrder, hiddenIds, sentences] = await Promise.all([
      getManifest(),
      getProjectOrder(),
      getHiddenImageIds(),
      getSentences(),
    ])

    // Fonts bypass the hidden filter: while the typeface feature is in
    // development the live (image-only) site hides the font via the
    // hidden list, but it must still appear here.
    const fontIds = new Set(manifest.filter(m => isFontFile(m.name)).map(m => m.id))
    const imageHidden = hiddenIds.filter(id => !fontIds.has(id))

    // Image entries map 1:1 to tiles; font files are grouped by folder into
    // typeface tiles. Ordering follows the canonical project order.
    const tiles = buildTiles(orderedVisible(manifest, projectOrder, imageHidden))

    // Sentences seed the typeface type-tester.
    return NextResponse.json({ tiles, sentences })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch images'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
