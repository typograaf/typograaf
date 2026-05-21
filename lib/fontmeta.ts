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
