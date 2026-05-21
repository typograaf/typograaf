// Client-side font utilities — registering @font-face faces and reading
// variable-font axes. These touch browser APIs; don't call during SSR.

export interface Axis {
  tag: string
  name: string
  min: number
  default: number
  max: number
}

const AXIS_NAMES: Record<string, string> = {
  wght: 'Weight',
  wdth: 'Width',
  slnt: 'Slant',
  ital: 'Italic',
  opsz: 'Optical Size',
  GRAD: 'Grade',
}

// Read the variable-font axes straight from the binary's `fvar` table. Only
// raw sfnt fonts (.ttf / .otf) can be parsed this way — .woff/.woff2 wrap
// the tables in compression, so those gracefully report no axes.
export function parseVariationAxes(buf: ArrayBuffer): Axis[] {
  try {
    const dv = new DataView(buf)
    const sfnt = dv.getUint32(0)
    // 0x00010000 TrueType, 'OTTO' CFF, 'true'/'typ1' legacy TrueType.
    const known = [0x00010000, 0x4f54544f, 0x74727565, 0x74797031]
    if (!known.includes(sfnt)) return []

    const numTables = dv.getUint16(4)
    let fvarOffset = -1
    for (let i = 0; i < numTables; i++) {
      const rec = 12 + i * 16
      if (dv.getUint32(rec) === 0x66766172 /* 'fvar' */) {
        fvarOffset = dv.getUint32(rec + 8)
        break
      }
    }
    if (fvarOffset < 0) return []

    const axesArrayOffset = dv.getUint16(fvarOffset + 4)
    const axisCount = dv.getUint16(fvarOffset + 8)
    const axisSize = dv.getUint16(fvarOffset + 10)
    const axes: Axis[] = []
    for (let i = 0; i < axisCount; i++) {
      const o = fvarOffset + axesArrayOffset + i * axisSize
      const tag = String.fromCharCode(
        dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3),
      )
      axes.push({
        tag,
        name: AXIS_NAMES[tag] || tag,
        min: dv.getInt32(o + 4) / 65536,
        default: dv.getInt32(o + 8) / 65536,
        max: dv.getInt32(o + 12) / 65536,
      })
    }
    return axes
  } catch {
    return []
  }
}

// Replace accented letters with their unaccented base.
export function deaccent(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

// Read the set of Unicode codepoints a font actually covers from its `cmap`
// table. Returns null when it can't be read (.woff/.woff2 are compressed).
export function parseCharSet(buf: ArrayBuffer): Set<number> | null {
  try {
    const dv = new DataView(buf)
    const sfnt = dv.getUint32(0)
    const known = [0x00010000, 0x4f54544f, 0x74727565, 0x74797031]
    if (!known.includes(sfnt)) return null

    const numTables = dv.getUint16(4)
    let cmap = -1
    for (let i = 0; i < numTables; i++) {
      const rec = 12 + i * 16
      if (dv.getUint32(rec) === 0x636d6170 /* 'cmap' */) { cmap = dv.getUint32(rec + 8); break }
    }
    if (cmap < 0) return null

    // Pick the best Unicode subtable — format 12 (full) over format 4 (BMP).
    const numSub = dv.getUint16(cmap + 2)
    let best = -1
    let bestFmt = -1
    for (let i = 0; i < numSub; i++) {
      const rec = cmap + 4 + i * 8
      const platform = dv.getUint16(rec)
      const encoding = dv.getUint16(rec + 2)
      const sub = cmap + dv.getUint32(rec + 4)
      const fmt = dv.getUint16(sub)
      const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10))
      if (!unicode) continue
      if (fmt === 12 && bestFmt !== 12) { best = sub; bestFmt = 12 }
      else if (fmt === 4 && bestFmt < 4) { best = sub; bestFmt = 4 }
    }
    if (best < 0) return null

    const set = new Set<number>()
    const addRange = (start: number, end: number) => {
      for (let c = start; c <= end && c - start < 10000; c++) set.add(c)
    }
    if (bestFmt === 12) {
      const groups = dv.getUint32(best + 12)
      for (let g = 0, o = best + 16; g < groups; g++, o += 12) {
        addRange(dv.getUint32(o), dv.getUint32(o + 4))
      }
    } else {
      const segX2 = dv.getUint16(best + 6)
      const endBase = best + 14
      const startBase = endBase + segX2 + 2
      for (let s = 0; s < segX2 / 2; s++) {
        const end = dv.getUint16(endBase + s * 2)
        const start = dv.getUint16(startBase + s * 2)
        if (start !== 0xffff && start <= end) addRange(start, end)
      }
    }
    return set
  } catch {
    return null
  }
}

// Module-cached charset load for tiles, which don't otherwise hold the
// font buffer. One fetch per font url.
const charSetCache = new Map<string, Promise<Set<number> | null>>()
export function loadCharSet(url: string): Promise<Set<number> | null> {
  let p = charSetCache.get(url)
  if (!p) {
    p = fetch(url).then(r => r.arrayBuffer()).then(parseCharSet).catch(() => null)
    charSetCache.set(url, p)
  }
  return p
}

// Make a string safe for a typeface: keep covered glyphs, swap an accented
// letter for its unaccented base when the font has the base, and drop any
// other glyph the font lacks. With no charset (couldn't read it) just
// de-accents as a best effort.
export function glyphSafeText(s: string, charset: Set<number> | null): string {
  if (!charset) return deaccent(s)
  let out = ''
  for (const ch of s) {
    const cp = ch.codePointAt(0)
    if (cp === undefined) continue
    if (charset.has(cp)) { out += ch; continue }
    const base = deaccent(ch)
    const baseCp = base.length === 1 ? base.codePointAt(0) : undefined
    if (baseCp !== undefined && baseCp !== cp && charset.has(baseCp)) out += base
  }
  return out
}

// A CSS-safe @font-face family name derived from a stable id.
export function fontFamilyFor(id: string): string {
  return 'tf-' + id.replace(/[^a-zA-Z0-9]/g, '-')
}

// Inject an @font-face once per family so repeated mounts don't re-declare it.
const injectedFonts = new Set<string>()
export function ensureFontFace(family: string, url: string) {
  if (typeof document === 'undefined' || injectedFonts.has(family)) return
  injectedFonts.add(family)
  const el = document.createElement('style')
  el.textContent = `@font-face{font-family:'${family}';src:url('${url}');font-display:swap}`
  document.head.appendChild(el)
}
