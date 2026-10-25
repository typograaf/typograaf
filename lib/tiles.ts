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

// Per-typeface defaults used by the tile specimen and type-tester when
// nothing is set in the CMS. `size` is the type size on the tile, in px.
export const DEFAULT_PREVIEW_WEIGHT = 700
export const DEFAULT_PREVIEW_LEADING = 1.12
export const DEFAULT_PREVIEW_SIZE = 40

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
  // Spaces stripped so "Extra Bold" ranks as extrabold; the longest match
  // wins so it isn't mistaken for plain bold.
  const lower = style.toLowerCase().replace(/\s+/g, '')
  let rank = WEIGHT_ORDER.length + 1
  let matched = 0
  WEIGHT_ORDER.forEach((w, i) => {
    if (w.length > matched && lower.includes(w)) {
      rank = i
      matched = w.length
    }
  })
  return rank
}

function titleCase(s: string): string {
  return s.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/\b\w/g, c => c.toUpperCase())
}

// Width names and the modifiers that attach to a weight or width
// ("SemiCondensed", "ExtraBold"). Without these a token like
// "CondensedMedium" reads as part of the family name, so an upright and
// its oblique become two families — two tiles — instead of one pair.
const WIDTH_WORDS = ['condensed', 'compressed', 'narrow', 'extended', 'expanded', 'wide']
const MODIFIER_WORDS = ['semi', 'extra', 'ultra', 'demi']

// Tokens that mark a weight, width, slope or variable suffix in a font
// filename.
const STYLE_WORDS = new Set([
  ...WEIGHT_ORDER,
  ...WIDTH_WORDS,
  ...MODIFIER_WORDS,
  'rounded',
  'italic', 'oblique', 'slanted', 'roman', 'upright', 'variable', 'vf', 'var',
])

// Longest first so e.g. "extrabold" wins over "bold" when suffix-matching.
const STYLE_WORDS_BY_LEN = [...STYLE_WORDS].sort((a, b) => b.length - a.length)

// Split a token made entirely of style words into those words, keeping the
// original casing ("CondensedMediumOblique" -> ["Condensed", "Medium",
// "Oblique"], "VariableVF" -> ["Variable", "VF"]). Null when any part of
// the token isn't a style word — i.e. it belongs to the family name.
function splitStyleWords(token: string): string[] | null {
  if (!token) return null
  const parts: string[] = []
  let rest = token
  while (rest.length > 0) {
    const lower = rest.toLowerCase()
    const w = STYLE_WORDS_BY_LEN.find(x => lower.endsWith(x))
    if (!w) return null
    parts.unshift(rest.slice(rest.length - w.length))
    rest = rest.slice(0, rest.length - w.length)
  }
  return parts
}

function isStyleToken(token: string): boolean {
  return /^[1-9]0{2}$/.test(token) || splitStyleWords(token) !== null
}

// The slope half of an upright/italic pair, by style name.
export function isSlopedStyle(style: string): boolean {
  return /italic|oblique|slanted/i.test(style)
}

// Strip trailing style words off a separator-less name ("BrigadaItalic" ->
// { family: "Brigada", style: "Italic" }) so joined and camelCase names pair
// the same way separated ones do. Keeps at least 2 chars of family.
function splitJoinedStyle(name: string): { family: string; style: string } {
  let family = name
  const styleParts: string[] = []
  let changed = true
  while (changed) {
    changed = false
    const lower = family.toLowerCase()
    for (const w of STYLE_WORDS_BY_LEN) {
      if (lower.endsWith(w) && family.length - w.length >= 2) {
        styleParts.unshift(family.slice(family.length - w.length))
        family = family.slice(0, family.length - w.length)
        changed = true
        break
      }
    }
  }
  return { family, style: styleParts.join(' ') }
}

export interface ParsedFontName {
  familyKey: string
  familyName: string
  style: string
}

// Split a font filename into its typeface family and its style: trailing
// weight/slope/variable tokens are the style, the rest is the family
// ("Mirror-Bold.woff2" -> family "Mirror", style "Bold"). Names with no
// separator are still split on their trailing style words ("BrigadaItalic"
// -> family "Brigada", style "Italic") so an upright and its italic pair.
export function parseFontName(fileName: string): ParsedFontName {
  const base = fileName.replace(/\.[^.]+$/, '')
  const tokens = base.split(/[-_\s]+/).filter(Boolean)
  if (tokens.length <= 1) {
    const { family, style } = splitJoinedStyle(base)
    return {
      familyKey: family.toLowerCase(),
      familyName: family,
      style: style ? titleCase(style) : 'Regular',
    }
  }
  let i = tokens.length - 1
  const styleTokens: string[] = []
  while (i >= 1 && isStyleToken(tokens[i])) {
    styleTokens.unshift(tokens[i])
    i--
  }
  const familyTokens = tokens.slice(0, i + 1)
  return {
    familyKey: familyTokens.join(' ').toLowerCase(),
    familyName: familyTokens.join(' '),
    style: styleTokens.length
      ? titleCase(styleTokens.map(t => (splitStyleWords(t) ?? [t]).join(' ')).join(' '))
      : 'Regular',
  }
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

function folderOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? '' : path.slice(0, slash)
}

/**
 * Collapse an ordered manifest into display tiles. Image entries map 1:1 to
 * image tiles. Font entries are grouped into typeface tiles by folder — but
 * a folder holding more than one typeface family is split into one tile per
 * family. Each tile sits at the position of its first font file so the
 * project ordering is preserved.
 */
export function buildTiles(ordered: ManifestImage[]): Tile[] {
  // Pass 1: how many distinct families does each folder hold?
  const familiesByFolder = new Map<string, Set<string>>()
  for (const entry of ordered) {
    if (!isFontFile(entry.name)) continue
    const folder = folderOf(entry.path)
    let set = familiesByFolder.get(folder)
    if (!set) familiesByFolder.set(folder, (set = new Set()))
    set.add(parseFontName(entry.name).familyKey)
  }

  // Pass 2: build the tiles. A multi-family folder splits per family.
  const out: Tile[] = []
  const tilesByKey = new Map<string, FontTile>()
  for (const entry of ordered) {
    if (!isFontFile(entry.name)) {
      out.push({ kind: 'image', id: entry.id, url: entry.blobUrl, path: entry.path })
      continue
    }

    const folder = folderOf(entry.path)
    const folderName = folder.slice(folder.lastIndexOf('/') + 1)
    const { familyKey, familyName, style } = parseFontName(entry.name)
    const multi = (familiesByFolder.get(folder)?.size ?? 1) > 1
    const groupKey = multi ? `${folder}::${familyKey}` : folder

    let tile = tilesByKey.get(groupKey)
    if (!tile) {
      tile = {
        kind: 'font',
        id: multi ? `font:${folder}::${familyKey}` : `font:${folder}`,
        path: entry.path,
        name: titleCase(multi ? familyName : folderName),
        styles: [],
      }
      tilesByKey.set(groupKey, tile)
      out.push(tile)
    }
    tile.styles.push({
      id: entry.id,
      name: entry.name,
      style,
      url: fontProxyUrl(entry.blobUrl),
    })
  }

  for (const tile of tilesByKey.values()) {
    tile.styles.sort(
      (a, b) => styleRank(a.style) - styleRank(b.style) || a.style.localeCompare(b.style),
    )
  }

  return out
}
