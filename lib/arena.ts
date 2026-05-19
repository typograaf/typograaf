import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import sharp from 'sharp'
import type { ManifestImage } from './sync'

// Mirrors the public portfolio to an Are.na channel as a *pure ordered
// mirror*: the channel ends up containing exactly the site's visible
// portfolio, in the same order as typografie.be, and nothing else. Opt-in:
// with no ARENA_ACCESS_TOKEN set every function here is a no-op so the core
// Dropbox -> R2 sync is never affected.
//
// Uses Are.na's v3 API (v2 is deprecated; the new personal access tokens
// only authenticate against v3). The token needs *write* scope.
//
// Are.na re-encodes whatever it ingests and its AVIF support is unreliable
// (silently fails some files) while WebP animation and alpha are mangled. So
// we never let Are.na touch our AVIF/WebP: a compatibility copy is transcoded
// into R2 under arena/v<N>/ and Are.na ingests that instead:
//   - animated WebP      -> animated GIF
//   - AVIF with alpha     -> PNG flattened onto white (deterministic white,
//                            not the source's grey transparent pixels)
//   - opaque AVIF         -> JPEG (Are.na ingests JPEG reliably)

const BUCKET = 'typograaf'
const PUBLIC_URL = process.env.R2_PUBLIC_URL || ''
const ARENA_MAP_KEY = 'arena-map.json'
const ARENA_API = 'https://api.are.na/v3'

// Bump when the transcode strategy changes: existing entries below this
// version are re-evaluated and their blocks replaced. The version is also in
// the R2 key so a new source URL forces Are.na to re-ingest.
const SRC_VERSION = 2
const ARENA_PREFIX = `arena/v${SRC_VERSION}`

// Per image id: the Are.na block id, the source URL we pushed, and the
// strategy version it was built with. Legacy entries are bare numbers or
// lack `v`.
type Entry = { block: number; src: string; v?: number }
type ArenaMap = Record<string, number | Entry>

function blockId(raw: number | Entry): number {
  return typeof raw === 'number' ? raw : raw.block
}
function entryVersion(raw: number | Entry): number {
  return typeof raw === 'number' ? 0 : raw.v ?? 0
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

// Are.na fetches the source URL the moment a block is created. If the object
// isn't publicly served yet the block fails permanently, so block on a real
// GET (not just HEAD) being 200 before handing the URL to Are.na.
async function r2Ready(key: string): Promise<boolean> {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await fetch(`${PUBLIC_URL}/${key}`, { cache: 'no-store' })
      if (res.ok) { await res.arrayBuffer(); return true }
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 400 * (attempt + 1)))
  }
  return false
}

async function r2Put(key: string, body: Buffer, contentType: string): Promise<void> {
  const client = getS3()
  await client.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }))
}

/**
 * The URL Are.na should ingest for this image, transcoding an Are.na-friendly
 * copy into R2 the first time it's needed (cached & reused afterwards).
 * Returns null on any failure (transcode error, or the object not yet
 * publicly served) — the caller then skips this image and retries next run,
 * rather than baking a source Are.na can't ingest.
 */
async function arenaSource(img: ManifestImage): Promise<string | null> {
  const ext = img.name.split('.').pop()?.toLowerCase() || ''
  const base = `${ARENA_PREFIX}/${safeId(img.id)}`
  try {
    let key: string
    if (ext === 'webp') {
      // The convert pipeline only ever produces WebP from an animated GIF,
      // so every .webp here is animated and must become a GIF for Are.na.
      key = `${base}.gif`
      if (!(await r2Exists(key))) {
        const buf = Buffer.from(await (await fetch(img.blobUrl)).arrayBuffer())
        const gif = await sharp(buf, { animated: true }).gif().toBuffer()
        await r2Put(key, gif, 'image/gif')
      }
    } else if (ext === 'avif') {
      const buf = Buffer.from(await (await fetch(img.blobUrl)).arrayBuffer())
      const hasAlpha = (await sharp(buf).metadata()).hasAlpha
      if (hasAlpha) {
        key = `${base}.png`
        if (!(await r2Exists(key))) {
          // Flatten onto white: transparent areas become solid white instead
          // of the source's grey transparent RGB bleeding through.
          const png = await sharp(buf).flatten({ background: '#ffffff' }).png().toBuffer()
          await r2Put(key, png, 'image/png')
        }
      } else {
        key = `${base}.jpg`
        if (!(await r2Exists(key))) {
          const jpg = await sharp(buf).jpeg({ quality: 90 }).toBuffer()
          await r2Put(key, jpg, 'image/jpeg')
        }
      }
    } else {
      return null
    }
    // Don't hand Are.na a URL it can't fetch yet — that fails the block.
    if (!(await r2Ready(key))) return null
    return `${PUBLIC_URL}/${key}`
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

async function removeConnection(connectionId: number, token: string): Promise<boolean> {
  try {
    const res = await fetch(`${ARENA_API}/connections/${connectionId}`, {
      method: 'DELETE',
      headers: authHeaders(token),
    })
    return res.ok || res.status === 404
  } catch {
    return false
  }
}

async function moveConnection(connectionId: number, token: string, position: number): Promise<boolean> {
  try {
    const res = await fetch(`${ARENA_API}/connections/${connectionId}/move`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ movement: 'insert_at', position }),
    })
    return res.ok
  } catch {
    return false
  }
}

type ChannelState = {
  byBlock: Map<number, number>      // block id -> connection id
  ordered: number[]                 // block ids in channel position order
  failed: Set<number>               // block ids Are.na failed to ingest
  complete: boolean
}

// Walks the whole channel: needed to resolve connection ids, find foreign
// blocks to delete, and know the current order. `complete` is false if any
// page failed, so callers don't drop tracking off a truncated walk.
async function getChannelState(slug: string, token: string): Promise<ChannelState> {
  const byBlock = new Map<number, number>()
  const positioned: Array<{ block: number; pos: number }> = []
  const failed = new Set<number>()
  let complete = true
  try {
    let page = 1
    for (;;) {
      let res: Response | null = null
      for (let attempt = 0; attempt < 4; attempt++) {
        res = await fetch(
          `${ARENA_API}/channels/${encodeURIComponent(slug)}/contents?per=100&page=${page}`,
          { headers: authHeaders(token) },
        )
        if (res.ok) break
        if (res.status !== 429 && res.status < 500) break
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)))
      }
      if (!res || !res.ok) { complete = false; break }
      const body = await res.json()
      const data: unknown[] = Array.isArray(body?.data) ? body.data : []
      for (const item of data as Array<{ id?: number; state?: string; connection?: { id?: number; position?: number } }>) {
        if (typeof item?.id === 'number' && typeof item?.connection?.id === 'number') {
          byBlock.set(item.id, item.connection.id)
          positioned.push({ block: item.id, pos: item.connection.position ?? 0 })
          if (item.state === 'failed') failed.add(item.id)
        }
      }
      if (!body?.meta?.has_more_pages) break
      page++
      await new Promise(r => setTimeout(r, 250))
    }
  } catch {
    complete = false
  }
  positioned.sort((a, b) => a.pos - b.pos)
  return { byBlock, ordered: positioned.map(p => p.block), failed, complete }
}

async function pooled<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let i = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await worker(items[i++])
  })
  await Promise.all(runners)
}

/**
 * Reconciles the Are.na channel to be exactly `desired` (already filtered to
 * visible images and sorted into the canonical site order), and nothing else.
 * Idempotent and crash-safe: heavy work (transcodes, replaces) that doesn't
 * finish in one run resumes on the next; the order pass only runs once the
 * set is fully converged so moves aren't wasted. Never throws.
 */
export async function reconcileArena(desired: ManifestImage[]): Promise<{ added: number; replaced: number; removed: number; reordered: number }> {
  const result = { added: 0, replaced: 0, removed: 0, reordered: 0 }
  const config = arenaConfig()
  if (!config) return result
  const { token, slug } = config

  try {
    const channelId = await resolveChannelId(slug, token)
    if (channelId === null) return result

    const map = await getArenaMap()
    const desiredIds = new Set(desired.map(img => img.id))

    let saveChain: Promise<void> = Promise.resolve()
    const persist = (): Promise<void> => {
      saveChain = saveChain.then(() => saveArenaMap(map)).catch(() => {})
      return saveChain
    }

    const state = await getChannelState(slug, token)
    let deferred = false

    const toAdd: ManifestImage[] = []
    const toReplace: ManifestImage[] = []
    for (const img of desired) {
      const raw = map[img.id]
      if (raw === undefined) { toAdd.push(img); continue }
      const block = blockId(raw)
      const src = typeof raw === 'number' ? '' : raw.src
      const validSrc = src.startsWith(`${PUBLIC_URL}/${ARENA_PREFIX}/`)
      // Re-create when the strategy version is stale, when the recorded
      // source isn't a real arena/v<N> transcode (a stale fallback baked by
      // older code), when Are.na failed to ingest the block, or when our
      // tracked block vanished from the channel (only trust "vanished" if
      // the walk was complete).
      if (
        entryVersion(raw) !== SRC_VERSION ||
        !validSrc ||
        state.failed.has(block) ||
        (state.complete && !state.byBlock.has(block))
      ) {
        toReplace.push(img)
      }
      // Otherwise the entry is at SRC_VERSION and healthy — trust it.
    }
    const toRemove = Object.keys(map).filter(id => !desiredIds.has(id))

    // Concurrency 2: some sources are huge animated strips (100+ frames,
    // >100k px tall) and decoding several at once peaks function memory.
    await pooled(toAdd, 2, async (img) => {
      const src = await arenaSource(img)
      if (src === null) { deferred = true; return }
      const id = await addBlock(channelId, token, src, img.name)
      if (id !== null) {
        map[img.id] = { block: id, src, v: SRC_VERSION }
        result.added++
        await persist()
      } else {
        deferred = true
      }
    })

    await pooled(toReplace, 2, async (img) => {
      const oldBlock = blockId(map[img.id])
      const conn = state.byBlock.get(oldBlock)
      if (conn === undefined && !state.complete) { deferred = true; return }
      const src = await arenaSource(img)
      if (src === null) { deferred = true; return } // keep old until good
      const id = await addBlock(channelId, token, src, img.name)
      if (id === null) { deferred = true; return }
      if (conn !== undefined) await removeConnection(conn, token)
      map[img.id] = { block: id, src, v: SRC_VERSION }
      result.replaced++
      await persist()
    })

    await pooled(toRemove, 3, async (id) => {
      const conn = state.byBlock.get(blockId(map[id]))
      if (conn === undefined && !state.complete) { deferred = true; return }
      const ok = conn === undefined ? true : await removeConnection(conn, token)
      if (ok) {
        delete map[id]
        result.removed++
        await persist()
      }
    })

    // Pure mirror: any block in the channel that isn't one we currently track
    // is foreign (the pre-existing blocks, or superseded old ones) and gets
    // removed. Presence-based, so a partial walk only means we catch the
    // rest next run — never a false positive.
    const ours = new Set(Object.values(map).map(blockId))
    for (const [block, conn] of state.byBlock) {
      if (!ours.has(block)) {
        if (await removeConnection(conn, token)) result.removed++
      }
    }

    await saveChain

    const mutated = result.added + result.replaced + result.removed > 0
    // Order once nothing changed this run. Don't gate on `deferred`: a few
    // images may be permanently un-transcodable (undecodable source, etc.)
    // and must not block ordering the rest forever. Missing blocks are just
    // skipped below.
    void deferred
    if (!mutated && state.complete) {
      const blockToConn = state.byBlock
      const want = desired
        .filter(img => map[img.id] !== undefined)
        .map(img => blockId(map[img.id]))
        .filter(b => blockToConn.has(b))
      const current = state.ordered.filter(b => blockToConn.has(b))
      // Walk target positions; move any block that isn't already there and
      // keep a local model in sync so later comparisons stay correct.
      for (let i = 0; i < want.length; i++) {
        if (current[i] === want[i]) continue
        const conn = blockToConn.get(want[i])
        if (conn === undefined) continue
        if (await moveConnection(conn, token, i + 1)) {
          const from = current.indexOf(want[i])
          if (from !== -1) current.splice(from, 1)
          current.splice(i, 0, want[i])
          result.reordered++
          await new Promise(r => setTimeout(r, 120)) // pace to avoid 429
        }
      }
    }

    return result
  } catch {
    return result
  }
}
