import { NextResponse } from 'next/server'
import { getManifest, getProjectOrder, orderedVisible } from '../../../lib/sync'
import { getHiddenImageIds } from '../../../lib/cms'
import { buildTiles } from '../../../lib/tiles'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const [manifest, projectOrder, hiddenIds] = await Promise.all([
      getManifest(),
      getProjectOrder(),
      getHiddenImageIds(),
    ])

    // Image entries map 1:1 to tiles; font files are grouped by folder into
    // typeface tiles. Ordering follows the canonical project order.
    const tiles = buildTiles(orderedVisible(manifest, projectOrder, hiddenIds))

    return NextResponse.json({ tiles })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch images'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
