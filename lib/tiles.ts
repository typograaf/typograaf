// Shared types and grouping logic for the portfolio grid. Deliberately
// free of server-only dependencies (no S3, no Dropbox) so this module is
// safe to import from client components as well as API routes.

export interface ManifestImage {
  id: string
  name: string
  path: string
  blobUrl: string
}

export const FONT_EXTENSIONS = ['.ttf', '.otf', '.woff', '.woff2'] as const

// Weight a typeface defaults to (tile specimen + type-tester opening) when
// nothing is set for it in the CMS.
export const DEFAULT_PREVIEW_WEIGHT = 700

export function isFontFile(name: string): boolean {
  const lower = name.toLowerCase()
  return FONT_EXTENSIONS.some(ext => lower.endsWith(ext))
}

// A regular image tile — renders the image, opens the zoom/pan lightbox.
export interface ImageTile {
  kind: 'image'
  id: string
  url: string
  path: string
}

// One weight/style file inside a typeface.
export interface FontFile {
  id: string
  name: string
  style: string
  url: string
}

// A typeface tile — every font file in the same folder grouped together.
// Renders an alphabet specimen, opens the type-tester preview.
export interface FontTile {
  kind: 'font'
  id: string
  path: string
  name: string
  styles: FontFile[]
}

export type Tile = ImageTile | FontTile

// Weight names ordered light -> heavy, used to sort the style switcher.
const WEIGHT_ORDER = [
  'thin', 'hairline', 'extralight', 'ultralight', 'light', 'book',
  'regular', 'normal', 'text', 'medium', 'semibold', 'demibold',
  'bold', 'extrabold', 'ultrabold', 'black', 'heavy', 'fat',
]

function styleRank(style: string): number {
  const lower = style.toLowerCase()
  for (let i = 0; i < WEIGHT_ORDER.length; i++) {
    if (lower.includes(WEIGHT_ORDER[i])) return i
  }
  return WEIGHT_ORDER.length + 1
}

function titleCase(s: string): string {
  return s.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/\b\w/g, c => c.toUpperCase())
}

// Derive a human style label from a font filename, stripping the typeface
// folder name prefix when present (e.g. "Mirror-Bold.woff2" -> "Bold").
export function styleLabel(fileName: string, folderName: string): string {
  let base = fileName.replace(/\.[^.]+$/, '')
  if (folderName && base.toLowerCase().startsWith(folderName.toLowerCase())) {
    base = base.slice(folderName.length)
  }
  base = base.replace(/^[-_\s]+/, '')
  const label = titleCase(base)
  return label || 'Regular'
}

// Convert an R2 blob URL into a same-origin font proxy URL. Serving fonts
// from our own origin sidesteps the cross-origin CORS requirement that
// @font-face enforces.
function fontProxyUrl(blobUrl: string): string {
  let key = blobUrl
  try {
    key = new URL(blobUrl).pathname.replace(/^\/+/, '')
  } catch {
    /* keep the raw value if it isn't a valid URL */
  }
  return `/api/font?key=${encodeURIComponent(key)}`
}

/**
 * Collapse an ordered manifest into display tiles. Image entries map 1:1 to
 * image tiles; font entries are grouped by their containing folder into a
 * single typeface tile, placed at the position of the group's first file so
 * the project ordering is preserved.
 */
export function buildTiles(ordered: ManifestImage[]): Tile[] {
  const out: Tile[] = []
  const byFolder = new Map<string, FontTile>()

  for (const entry of ordered) {
    if (!isFontFile(entry.name)) {
      out.push({ kind: 'image', id: entry.id, url: entry.blobUrl, path: entry.path })
      continue
    }

    const slash = entry.path.lastIndexOf('/')
    const folderPath = slash === -1 ? '' : entry.path.slice(0, slash)
    const folderName = folderPath.slice(folderPath.lastIndexOf('/') + 1)

    let tile = byFolder.get(folderPath)
    if (!tile) {
      tile = {
        kind: 'font',
        id: `font:${folderPath}`,
        path: entry.path,
        name: titleCase(folderName),
        styles: [],
      }
      byFolder.set(folderPath, tile)
      out.push(tile)
    }
    tile.styles.push({
      id: entry.id,
      name: entry.name,
      style: styleLabel(entry.name, folderName),
      url: fontProxyUrl(entry.blobUrl),
    })
  }

  for (const tile of byFolder.values()) {
    tile.styles.sort(
      (a, b) => styleRank(a.style) - styleRank(b.style) || a.style.localeCompare(b.style),
    )
  }

  return out
}
