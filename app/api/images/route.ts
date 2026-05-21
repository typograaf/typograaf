import { NextResponse } from 'next/server'
import { getManifest, getProjectOrder, orderedVisible } from '../../../lib/sync'
import { getHiddenImageIds, getSentences, getPreviewAxes } from '../../../lib/cms'
import { buildTiles } from '../../../lib/tiles'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const [manifest, projectOrder, hiddenIds, sentences, previewAxes] = await Promise.all([
      getManifest(),
      getProjectOrder(),
      getHiddenImageIds(),
      getSentences(),
      getPreviewAxes(),
    ])

    // Image entries map 1:1 to tiles; font files are grouped by folder into
    // typeface tiles. Ordering follows the canonical project order.
    const tiles = buildTiles(orderedVisible(manifest, projectOrder, hiddenIds))

    // Sentences seed the type-tester; previewAxes set each typeface's
    // default variable-axis values (keyed by font tile id).
    return NextResponse.json({ tiles, sentences, previewAxes })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch images'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
