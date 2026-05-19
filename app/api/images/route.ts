import { NextResponse } from 'next/server'
import { getManifest, getProjectOrder, orderedVisible } from '../../../lib/sync'
import { getHiddenImageIds } from '../../../lib/cms'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const [manifest, projectOrder, hiddenIds] = await Promise.all([
      getManifest(),
      getProjectOrder(),
      getHiddenImageIds(),
    ])

    const images = orderedVisible(manifest, projectOrder, hiddenIds).map(img => ({
      id: img.id,
      url: img.blobUrl,
      path: img.path,
    }))

    return NextResponse.json({ images })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch images'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
