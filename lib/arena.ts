import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import type { ManifestImage } from './sync'

// Mirrors the public portfolio to an Are.na channel. Every synced image is
// pushed as a block (Are.na fetches it from its public R2 URL); deletions and
// hides remove it. The whole feature is opt-in: with no ARENA_ACCESS_TOKEN
// set, every function here is a no-op so the core Dropbox -> R2 sync is never
// affected.
//
// Uses Are.na's v3 API. v2 is deprecated and the new personal access tokens
// only authenticate against v3. The token needs *write* scope to add/remove
// blocks (a read-only token simply makes this a silent no-op).

const BUCKET = 'typograaf'
const PUBLIC_URL = process.env.R2_PUBLIC_URL || ''
const ARENA_MAP_KEY = 'arena-map.json'
const ARENA_API = 'https://api.are.na/v3'

// Maps manifest image id -> Are.na block id.
type ArenaMap = Record<string, number>

function arenaConfig(): { token: string; slug: string } | null {
  const token = process.env.ARENA_ACCESS_TOKEN
  const slug = process.env.ARENA_CHANNEL_SLUG
  if (!token || !slug) return null
  return { token, slug }
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

function getS3() {
  return new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT!,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  })
}

async function getArenaMap(): Promise<ArenaMap> {
  try {
    const res = await fetch(`${PUBLIC_URL}/${ARENA_MAP_KEY}?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return {}
    const data = await res.json()
    return data && typeof data === 'object' ? (data as ArenaMap) : {}
  } catch {
    return {}
  }
}

async function saveArenaMap(map: ArenaMap): Promise<void> {
  const client = getS3()
  await client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: ARENA_MAP_KEY,
    Body: JSON.stringify(map),
    ContentType: 'application/json',
  }))
}

// v3 block creation needs the numeric channel id; the slug only works on
// reads. Resolved once per process.
let cachedChannelId: number | null = null
async function resolveChannelId(slug: string, token: string): Promise<number | null> {
  if (cachedChannelId !== null) return cachedChannelId
  try {
    const res = await fetch(`${ARENA_API}/channels/${encodeURIComponent(slug)}`, {
      headers: authHeaders(token),
    })
    if (!res.ok) return null
    const data = await res.json()
    if (typeof data?.id === 'number') {
      cachedChannelId = data.id
      return data.id
    }
    return null
  } catch {
    return null
  }
}

async function addBlock(channelId: number, token: string, value: string, title: string): Promise<number | null> {
  try {
    const res = await fetch(`${ARENA_API}/blocks`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ value, title, channels: [{ id: channelId }] }),
    })
    if (!res.ok) return null
    const block = await res.json()
    return typeof block?.id === 'number' ? block.id : null
  } catch {
    return null
  }
}

// Walks the channel's contents and builds blockId -> connectionId. The
// connection id is required to remove a block from the channel and is not
// returned by block creation, so it has to be looked up here.
async function getConnectionIndex(slug: string, token: string): Promise<Map<number, number>> {
  const index = new Map<number, number>()
  try {
    let page = 1
    for (;;) {
      const res = await fetch(
        `${ARENA_API}/channels/${encodeURIComponent(slug)}/contents?per=100&page=${page}`,
        { headers: authHeaders(token) },
      )
      if (!res.ok) break
      const body = await res.json()
      const data: unknown[] = Array.isArray(body?.data) ? body.data : []
      for (const item of data as Array<{ id?: number; connection?: { id?: number } }>) {
        if (typeof item?.id === 'number' && typeof item?.connection?.id === 'number') {
          index.set(item.id, item.connection.id)
        }
      }
      if (!body?.meta?.has_more_pages) break
      page++
    }
  } catch {
    /* partial index is fine — unresolved removals retry next reconcile */
  }
  return index
}

async function removeConnection(connectionId: number, token: string): Promise<boolean> {
  try {
    const res = await fetch(`${ARENA_API}/connections/${connectionId}`, {
      method: 'DELETE',
      headers: authHeaders(token),
    })
    // 404 = already gone; treat as success so the map heals.
    return res.ok || res.status === 404
  } catch {
    return false
  }
}

// Runs tasks with a small concurrency cap so a large backfill doesn't hammer
// the Are.na API (or blow the function timeout) all at once.
async function pooled<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let i = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++]
      await worker(item)
    }
  })
  await Promise.all(runners)
}

/**
 * Reconciles the Are.na channel against the desired set of public images.
 * Idempotent: only the diff is applied, so a backfill that doesn't finish
 * within one run simply continues on the next sync. Never throws — Are.na
 * failures must not break the Dropbox -> R2 pipeline.
 */
export async function reconcileArena(manifest: ManifestImage[], hiddenIds: string[]): Promise<{ added: number; removed: number }> {
  const config = arenaConfig()
  if (!config) return { added: 0, removed: 0 }
  const { token, slug } = config

  try {
    const channelId = await resolveChannelId(slug, token)
    if (channelId === null) return { added: 0, removed: 0 }

    const hidden = new Set(hiddenIds)
    const desired = manifest.filter(img => !hidden.has(img.id))
    const desiredIds = new Set(desired.map(img => img.id))

    const map = await getArenaMap()

    const toAdd = desired.filter(img => !(img.id in map))
    const toRemove = Object.keys(map).filter(id => !desiredIds.has(id))

    let added = 0
    let removed = 0

    await pooled(toAdd, 5, async (img) => {
      const blockId = await addBlock(channelId, token, img.blobUrl, img.name)
      if (blockId !== null) {
        map[img.id] = blockId
        added++
      }
    })

    if (toRemove.length > 0) {
      // One contents walk resolves every connection id we need to delete.
      const connIndex = await getConnectionIndex(slug, token)
      await pooled(toRemove, 5, async (id) => {
        const blockId = map[id]
        const connectionId = connIndex.get(blockId)
        // No connection found means it's no longer in the channel — drop it
        // from the map so we stop trying.
        const ok = connectionId === undefined ? true : await removeConnection(connectionId, token)
        if (ok) {
          delete map[id]
          removed++
        }
      })
    }

    if (added > 0 || removed > 0) {
      await saveArenaMap(map)
    }

    return { added, removed }
  } catch {
    return { added: 0, removed: 0 }
  }
}
