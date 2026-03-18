import { list, put, del } from '@vercel/blob'
import { getDropboxImageFiles, getDropboxTempLink } from './dropbox'

export interface ManifestImage {
  id: string
  name: string
  path: string
  blobUrl: string
}

export async function getManifest(): Promise<ManifestImage[]> {
  try {
    const { blobs } = await list({ prefix: 'manifest.json' })
    if (!blobs.length) return []
    const res = await fetch(blobs[0].url)
    return res.json()
  } catch {
    return []
  }
}

async function saveManifest(images: ManifestImage[]): Promise<void> {
  await put('manifest.json', JSON.stringify(images), {
    access: 'public',
    allowOverwrite: true,
    contentType: 'application/json',
  })
}

export async function syncWithDropbox(): Promise<{ added: number; deleted: number }> {
  const [dropboxFiles, manifest] = await Promise.all([
    getDropboxImageFiles(),
    getManifest(),
  ])

  const manifestById = new Map(manifest.map(img => [img.id, img]))
  const dropboxById = new Map(dropboxFiles.map(f => [f.id, f]))

  const toAdd = dropboxFiles.filter(f => !manifestById.has(f.id))
  const toDelete = manifest.filter(img => !dropboxById.has(img.id))

  // Delete removed images from Blob
  await Promise.all(toDelete.map(img => del(img.blobUrl).catch(() => {})))

  // Upload new images to Blob
  const added: ManifestImage[] = (
    await Promise.all(
      toAdd.map(async (file) => {
        try {
          const tempUrl = await getDropboxTempLink(file.path)
          const imageRes = await fetch(tempUrl)
          const imageBuffer = await imageRes.arrayBuffer()
          const ext = file.name.split('.').pop() || 'jpg'
          const blob = await put(`images/${file.id}.${ext}`, imageBuffer, {
            access: 'public',
            allowOverwrite: true,
            contentType: imageRes.headers.get('content-type') || 'image/jpeg',
          })
          return { id: file.id, name: file.name, path: file.path, blobUrl: blob.url }
        } catch {
          return null
        }
      })
    )
  ).filter((img): img is ManifestImage => img !== null)

  const deletedIds = new Set(toDelete.map(img => img.id))
  const newManifest = [
    ...manifest.filter(img => !deletedIds.has(img.id)),
    ...added,
  ]

  await saveManifest(newManifest)
  return { added: added.length, deleted: toDelete.length }
}
