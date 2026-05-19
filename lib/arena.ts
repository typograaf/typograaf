import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import sharp from 'sharp'
import type { ManifestImage } from './sync'

// Mirrors the public portfolio to an Are.na channel. Every synced image is
// pushed as a block (Are.na fetches it from a public R2 URL); deletions and
// hides remove it. Opt-in: with no ARENA_ACCESS_TOKEN set, every function
// here is a no-op so the core Dropbox -> R2 sync is never affected.
//
// Uses Are.na's v3 API. v2 is deprecated and the new personal access tokens
// only authenticate against v3. The token needs *write* scope.
//
// Are.na re-encodes whatever it ingests through its own pipeline, which
// flattens alpha to JPEG and strips WebP animation. Our R2 stores AVIF +
// animated WebP, both of which Are.na mangles. So for the formats Are.na
// can't handle we transcode a compatibility copy into R2 under arena/ and
// hand Are.na *that*:
//   - AVIF with alpha   -> PNG  (Are.na preserves PNG transparency)
//   - animated WebP      -> GIF  (Are.na animates GIF, not WebP)
//   - opaque AVIF        -> left as-is (Are.na's AVIF->JPEG is fine)

const BUCKET = 'typograaf'
const PUBLIC_URL = process.env.R2_PUBLIC_URL || ''
const ARENA_MAP_KEY = 'arena-map.json'
const ARENA_API = 'https://api.are.na/v3'

// Per image id: the Are.na block id plus the exact source URL we pushed, so a
// later run can tell a block was created from a now-superseded source (e.g.
// the pre-transcode blobUrl) and replace it. Legacy entries are bare numbers.
type Entry = { block: number; src: string }
type ArenaMap = Record<string, number | Entry>

function blockId(raw: number | Entry): number {
  return typeof raw === 'number' ? raw : raw.block
}

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

function safeId(id: string): string {
  return id.replace(':', '_')
}

async function r2Exists(key: string): Promise<boolean> {
  try {
    const res = await fetch(`${PUBLIC_URL}/${key}`, { method: 'HEAD' })
    return res.ok
  } catch {
    return false
  }
}

async function r2Put(key: string, body: Buffer, contentType: string): Promise<void> {
  const client = getS3()
  await client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
  }))
}

/**
 * Returns the URL Are.na should ingest for this image, transcoding an
 * Are.na-friendly copy into R2 the first time it's needed. Idempotent: a
 * transcoded variant already in R2 is reused. Falls back to the original
 * blobUrl on any failure so the mirror still gets *something*.
 */
async function arenaSource(img: ManifestImage): Promise<string> {
  const ext = img.name.split('.').pop()?.toLowerCase() || ''
  try {
    // The convert pipeline only ever produces WebP from an animated GIF, so
    // every .webp here is animated and must become a GIF for Are.na.
    if (ext === 'webp') {
      const key = `arena/${safeId(img.id)}.gif`
      if (!(await r2Exists(key))) {
        const buf = Buffer.from(await (await fetch(img.blobUrl)).arrayBuffer())
        const gif = await sharp(buf, { animated: true }).gif().toBuffer()
        await r2Put(key, gif, 'image/gif')
      }
      return `${PUBLIC_URL}/${key}`
    }

    if (ext === 'avif') {
      const key = `arena/${safeId(img.id)}.png`
      if (await r2Exists(key)) return `${PUBLIC_URL}/${key}`
      const buf = Buffer.from(await (await fetch(img.blobUrl)).arrayBuffer())
      const meta = await sharp(buf).metadata()
      // Opaque AVIF: Are.na's AVIF->JPEG is fine, keep the original.
      if (!meta.hasAlpha) return img.blobUrl
      const png = await sharp(buf).png().toBuffer()
      await r2Put(key, png, 'image/png')
      return `${PUBLIC_URL}/${key}`
    }
  } catch {
    return img.blobUrl
  }
  return img.blobUrl
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
    /* partial index is fine — unresolved ops retry next reconcile */
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

// Concurrency cap: transcoding is CPU-heavy, so keep this low.
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
 * Idempotent: only the diff is applied, so a backfill (or a batch of
 * transcodes) that doesn't finish within one run continues on the next sync.
 * Never throws — Are.na failures must not break the Dropbox -> R2 pipeline.
 */
export async function reconcileArena(manifest: ManifestImage[], hiddenIds: string[]): Promise<{ added: number; replaced: number; removed: number }> {
  const result = { added: 0, replaced: 0, removed: 0 }
  const config = arenaConfig()
  if (!config) return result
  const { token, slug } = config

  try {
    const channelId = await resolveChannelId(slug, token)
    if (channelId === null) return result

    const hidden = new Set(hiddenIds)
    const desired = manifest.filter(img => !hidden.has(img.id))
    const desiredIds = new Set(desired.map(img => img.id))

    const map = await getArenaMap()

    // A long transcoding backfill can hit the function timeout mid-run. Save
    // after every mutation (serialized) so a kill never orphans created
    // blocks — the map JSON is tiny and the next run resumes from it.
    let saveChain: Promise<void> = Promise.resolve()
    const persist = (): Promise<void> => {
      saveChain = saveChain.then(() => saveArenaMap(map)).catch(() => {})
      return saveChain
    }

    const toAdd: ManifestImage[] = []
    // Legacy bare-number entries: created before transcoding, so the source
    // may be wrong. Recheck and replace if so.
    const toCheck: ManifestImage[] = []
    for (const img of desired) {
      const raw = map[img.id]
      if (raw === undefined) toAdd.push(img)
      else if (typeof raw === 'number') toCheck.push(img)
      // Object entries are trusted as already-correct (skip — no re-download).
    }
    const toRemove = Object.keys(map).filter(id => !desiredIds.has(id))

    await pooled(toAdd, 3, async (img) => {
      const src = await arenaSource(img)
      const id = await addBlock(channelId, token, src, img.name)
      if (id !== null) {
        map[img.id] = { block: id, src }
        result.added++
        await persist()
      }
    })

    // Resolving + replacing legacy entries and removals both need connection
    // ids — one contents walk covers all of it.
    const needIndex = toCheck.length > 0 || toRemove.length > 0
    const connIndex = needIndex ? await getConnectionIndex(slug, token) : new Map<number, number>()

    await pooled(toCheck, 3, async (img) => {
      const oldBlock = blockId(map[img.id])
      const src = await arenaSource(img)
      if (src === img.blobUrl) {
        // Source unchanged — the existing block is fine, just upgrade the
        // map entry so we don't re-download it next time.
        map[img.id] = { block: oldBlock, src }
        await persist()
        return
      }
      // Source superseded by a transcoded copy: drop the old block and
      // recreate from the good source.
      const connId = connIndex.get(oldBlock)
      if (connId !== undefined) await removeConnection(connId, token)
      const id = await addBlock(channelId, token, src, img.name)
      if (id !== null) {
        map[img.id] = { block: id, src }
        result.replaced++
        await persist()
      }
    })

    await pooled(toRemove, 3, async (id) => {
      const connId = connIndex.get(blockId(map[id]))
      const ok = connId === undefined ? true : await removeConnection(connId, token)
      if (ok) {
        delete map[id]
        result.removed++
        await persist()
      }
    })

    await saveChain
    return result
  } catch {
    return result
  }
}
