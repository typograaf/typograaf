import { NextResponse } from 'next/server'
import { getManifest, getProjectOrder } from '../../../lib/sync'
import { getHiddenImageIds } from '../../../lib/cms'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const [manifest, projectOrder, hiddenIds] = await Promise.all([
      getManifest(),
      getProjectOrder(),
      getHiddenImageIds(),
    ])
    const hidden = new Set(hiddenIds)
    const visible = manifest.filter(img => !hidden.has(img.id))
    const folderPath = (process.env.DROPBOX_FOLDER_PATH || '').toLowerCase()

    const getProject = (path: string) => {
      const parts = path.split('/')
      const baseDepth = folderPath.split('/').length
      return parts[baseDepth] || ''
    }

    const sorted = [...visible].sort((a, b) => {
      const projectA = getProject(a.path)
      const projectB = getProject(b.path)
      const indexA = projectOrder.findIndex(p => p.toLowerCase() === projectA)
      const indexB = projectOrder.findIndex(p => p.toLowerCase() === projectB)
      const orderA = indexA === -1 ? -1 : indexA
      const orderB = indexB === -1 ? -1 : indexB
      if (orderA !== orderB) return orderA - orderB
      return a.name.localeCompare(b.name)
    })

    const images = sorted.map(img => ({
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
