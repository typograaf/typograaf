import { NextRequest, NextResponse } from 'next/server'
import { getManifest, getProjectOrder, orderedVisible, orderedSelected } from '../../../lib/sync'
import { getHiddenImageIds, getPortfolioImageIds, getSentences, getPreviewAxes } from '../../../lib/cms'
import { buildTiles } from '../../../lib/tiles'

export const dynamic = 'force-dynamic'

// `?set=portfolio` serves the curated /portfolio selection instead of the
// home feed. Both share sentences and preview axes.
export async function GET(request: NextRequest) {
  try {
    const portfolio = request.nextUrl.searchParams.get('set') === 'portfolio'
    const [manifest, projectOrder, selection, sentences, previewAxes] = await Promise.all([
      getManifest(),
      getProjectOrder(),
      portfolio ? getPortfolioImageIds() : getHiddenImageIds(),
      getSentences(),
      getPreviewAxes(),
    ])

    // Image entries map 1:1 to tiles; font files are grouped by folder into
    // typeface tiles. Ordering follows the canonical project order.
    const entries = portfolio
      ? orderedSelected(manifest, projectOrder, selection)
      : orderedVisible(manifest, projectOrder, selection)
    const tiles = buildTiles(entries)

    // Sentences seed the type-tester; previewAxes set each typeface's
    // default variable-axis values (keyed by font tile id). `ready` tells
    // the client the manifest was read, so an empty portfolio is a real
    // answer rather than something to retry.
    return NextResponse.json({ tiles, sentences, previewAxes, ready: manifest.length > 0 })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch images'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
