import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getDropboxImageFiles, getDropboxTempLink, deleteDropboxFile } from './dropbox'
import bundledProjectOrder from '../project-order.json'
import { getProjectOrderOverride, getHiddenImageIds } from './cms'
import { reconcileArena } from './arena'

export interface ManifestImage {
  id: string
  name: string
  path: string
  blobUrl: string
}

function getS3Client() {
  return new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT!,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  })
}

const BUCKET = 'typograaf'
const PUBLIC_URL = process.env.R2_PUBLIC_URL || ''
const RECENT_KEY = 'recent-projects.json'

export async function getManifest(): Promise<ManifestImage[]> {
  try {
    const res = await fetch(`${PUBLIC_URL}/manifest.json`, { cache: 'no-store' })
    if (!res.ok) return []
    return res.json()
  } catch {
    return []
  }
}

async function saveManifest(images: ManifestImage[]): Promise<void> {
  const client = getS3Client()
  await client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: 'manifest.json',
    Body: JSON.stringify(images),
    ContentType: 'application/json',
  }))
}

async function getRecentProjects(): Promise<string[]> {
  try {
    const res = await fetch(`${PUBLIC_URL}/${RECENT_KEY}`, { cache: 'no-store' })
    if (!res.ok) return []
    const data = await res.json()
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

async function saveRecentProjects(projects: string[]): Promise<void> {
  const client = getS3Client()
  await client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: RECENT_KEY,
    Body: JSON.stringify(projects),
    ContentType: 'application/json',
  }))
}

export async function getProjectOrder(): Promise<string[]> {
  const [recent, override] = await Promise.all([getRecentProjects(), getProjectOrderOverride()])
  const main = override || bundledProjectOrder
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of [...recent, ...main]) {
    const key = p.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(p)
  }
  return out
}

function projectFromPath(path: string): string {
  const folderPath = (process.env.DROPBOX_FOLDER_PATH || '').toLowerCase()
  const baseDepth = folderPath.split('/').length
  const parts = path.split('/')
  return parts[baseDepth] || ''
}

/**
 * The canonical public display order: by project order (case-insensitive;
 * projects not in the order list sort first), then filename. The portfolio
 * page and the Are.na mirror both consume this so the board can't drift out
 * of sync with the site.
 */
export function orderedVisible(
  manifest: ManifestImage[],
  projectOrder: string[],
  hiddenIds: string[],
): ManifestImage[] {
  const hidden = new Set(hiddenIds)
  const visible = manifest.filter(img => !hidden.has(img.id))
  const orderIndex = (path: string) => {
    const project = projectFromPath(path)
    const i = projectOrder.findIndex(p => p.toLowerCase() === project)
    return i === -1 ? -1 : i
  }
  return [...visible].sort((a, b) => {
    const oa = orderIndex(a.path)
    const ob = orderIndex(b.path)
    if (oa !== ob) return oa - ob
    return a.name.localeCompare(b.name)
  })
}

async function updateRecentProjects(manifest: ManifestImage[]): Promise<void> {
  const projectsInManifest = new Set(
    manifest.map(img => projectFromPath(img.path)).filter(Boolean)
  )
  const bundledLower = new Set(bundledProjectOrder.map(p => p.toLowerCase()))
  const previousRecent = await getRecentProjects()

  const keptRecent = previousRecent.filter(p => {
    const lower = p.toLowerCase()
    return projectsInManifest.has(lower) && !bundledLower.has(lower)
  })
  const keptLower = new Set(keptRecent.map(p => p.toLowerCase()))

  const brandNew = [...projectsInManifest].filter(
    p => !bundledLower.has(p) && !keptLower.has(p)
  )

  const newRecent = [...brandNew, ...keptRecent]

  const unchanged =
    newRecent.length === previousRecent.length &&
    newRecent.every((p, i) => p === previousRecent[i])
  if (unchanged) return

  await saveRecentProjects(newRecent)
}

export async function syncWithDropbox(): Promise<{ added: number; deleted: number; arena: { added: number; replaced: number; removed: number; reordered: number } }> {
  const [dropboxFiles, manifest] = await Promise.all([
    getDropboxImageFiles(),
    getManifest(),
  ])

  const manifestById = new Map(manifest.map(img => [img.id, img]))
  const dropboxById = new Map(dropboxFiles.map(f => [f.id, f]))

  const toAdd = dropboxFiles.filter(f => !manifestById.has(f.id))
  const toDelete = manifest.filter(img => !dropboxById.has(img.id))

  const client = getS3Client()

  // Delete removed images from R2
  await Promise.all(toDelete.map(img => {
    const key = img.blobUrl.replace(`${PUBLIC_URL}/`, '')
    return client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key })).catch(() => {})
  }))

  // Upload new images to R2
  const added: ManifestImage[] = (
    await Promise.all(
      toAdd.map(async (file) => {
        try {
          const tempUrl = await getDropboxTempLink(file.path)
          const imageRes = await fetch(tempUrl)
          const imageBuffer = await imageRes.arrayBuffer()
          const ext = file.name.split('.').pop() || 'jpg'
          const safeId = file.id.replace(':', '_')
          const key = `images/${safeId}.${ext}`
          await client.send(new PutObjectCommand({
            Bucket: BUCKET,
            Key: key,
            Body: Buffer.from(imageBuffer),
            ContentType: imageRes.headers.get('content-type') || 'image/jpeg',
          }))
          return { id: file.id, name: file.name, path: file.path, blobUrl: `${PUBLIC_URL}/${key}` }
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
  await updateRecentProjects(newManifest)

  // Mirror to Are.na (best-effort; no-op unless ARENA_* env is set). The
  // desired set is the canonical ordered, visible portfolio so the board is
  // an exact mirror of the site.
  const [projectOrder, hidden] = await Promise.all([getProjectOrder(), getHiddenImageIds()])
  const arena = await reconcileArena(orderedVisible(newManifest, projectOrder, hidden))

  return { added: added.length, deleted: toDelete.length, arena }
}

export async function deleteImage(id: string): Promise<{ deleted: boolean }> {
  const manifest = await getManifest()
  const target = manifest.find(img => img.id === id)
  if (!target) return { deleted: false }

  // Dropbox first — if this fails the file would just resync into R2.
  await deleteDropboxFile(target.path)

  // Best-effort R2 cleanup. A failure here self-heals on the next sync.
  const client = getS3Client()
  const key = target.blobUrl.replace(`${PUBLIC_URL}/`, '')
  await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key })).catch(() => {})

  const newManifest = manifest.filter(img => img.id !== id)
  await saveManifest(newManifest)
  await updateRecentProjects(newManifest)

  // Drop the matching Are.na block so the board mirrors the deletion.
  const [projectOrder, hidden] = await Promise.all([getProjectOrder(), getHiddenImageIds()])
  await reconcileArena(orderedVisible(newManifest, projectOrder, hidden))

  return { deleted: true }
}
