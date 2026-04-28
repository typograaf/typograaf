import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getDropboxImageFiles, getDropboxTempLink } from './dropbox'
import bundledProjectOrder from '../project-order.json'

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
  const recent = await getRecentProjects()
  return [...recent, ...bundledProjectOrder]
}

function projectFromPath(path: string): string {
  const folderPath = (process.env.DROPBOX_FOLDER_PATH || '').toLowerCase()
  const baseDepth = folderPath.split('/').length
  const parts = path.split('/')
  return parts[baseDepth] || ''
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

export async function syncWithDropbox(): Promise<{ added: number; deleted: number }> {
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
  return { added: added.length, deleted: toDelete.length }
}
