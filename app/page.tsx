'use client'

import { useEffect, useLayoutEffect, useState, useCallback, useRef, useMemo, useDeferredValue } from 'react'
import type { Tile, ImageTile, FontTile, FontFile } from '../lib/tiles'

const BUFFER_ROWS = 3

const SPECIMEN = 'AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz'

// A per-load random offset so the grid shows a different sample sentence
// each visit, while staying stable for a given cell as you scroll.
const sentenceSeed = Math.floor(Math.random() * 100000)

function pickSentence(sentences: string[], index: number): string {
  if (sentences.length === 0) return SPECIMEN
  return sentences[(index + sentenceSeed) % sentences.length]
}

// ---------------------------------------------------------------------------
// Font helpers
// ---------------------------------------------------------------------------

// Pick the file that best represents a typeface at a glance (a regular-ish
// weight rather than a Thin or Black extreme).
function representativeStyle(tile: FontTile): FontFile {
  return (
    tile.styles.find(s => /regular|book|normal|text/i.test(s.style)) ||
    tile.styles[Math.floor(tile.styles.length / 2)] ||
    tile.styles[0]
  )
}

// A CSS-safe @font-face family name derived from a stable id.
function fontFamilyFor(id: string): string {
  return 'tf-' + id.replace(/[^a-zA-Z0-9]/g, '-')
}

// Inject an @font-face once per family so virtualised tiles can render a
// specimen without each mount re-declaring the face.
const injectedFonts = new Set<string>()
function ensureFontFace(family: string, url: string) {
  if (typeof document === 'undefined' || injectedFonts.has(family)) return
  injectedFonts.add(family)
  const el = document.createElement('style')
  el.textContent = `@font-face{font-family:'${family}';src:url('${url}');font-display:swap}`
  document.head.appendChild(el)
}

interface Axis {
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
function parseVariationAxes(buf: ArrayBuffer): Axis[] {
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

// ---------------------------------------------------------------------------

export default function Home() {
  const [tiles, setTiles] = useState<Tile[]>([])
  const [sentences, setSentences] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedImage, setSelectedImage] = useState<ImageTile | null>(null)
  const [selectedFont, setSelectedFont] = useState<FontTile | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [columns, setColumns] = useState(8)
  const [windowHeight, setWindowHeight] = useState(800)
  // Initialize and update layout (useLayoutEffect to prevent flash)
  useLayoutEffect(() => {
    const updateLayout = () => {
      const width = window.innerWidth
      if (width <= 500) setColumns(2)
      else if (width <= 700) setColumns(3)
      else if (width <= 900) setColumns(4)
      else if (width <= 1100) setColumns(5)
      else if (width <= 1400) setColumns(6)
      else if (width <= 1600) setColumns(7)
      else setColumns(8)
      setWindowHeight(window.innerHeight)
    }
    updateLayout()
    window.addEventListener('resize', updateLayout)
    return () => window.removeEventListener('resize', updateLayout)
  }, [])

  // Scroll to top on mount and ensure scroll is unlocked
  useEffect(() => {
    document.documentElement.classList.remove('lightbox-open')
    document.body.style.top = ''
    window.scrollTo(0, 0)
  }, [])

  // Track scroll position (but not when a modal is open). rAF-coalesce
  // so we set state at most once per frame even on high-DPI trackpads.
  const lightboxOpenRef = useRef(false)
  useEffect(() => {
    let pending = false
    const handleScroll = () => {
      if (lightboxOpenRef.current || pending) return
      pending = true
      requestAnimationFrame(() => {
        pending = false
        setScrollTop(window.scrollY)
      })
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])
  // Icon layers are preloaded from <head> in app/layout.tsx — no JS effect needed.

  const loadImages = useCallback((retryCount = 0) => {
    setLoading(true)
    fetch('/api/images')
      .then(res => res.json())
      .then(data => {
        if (data.tiles && data.tiles.length > 0) {
          setTiles(data.tiles)
          if (Array.isArray(data.sentences)) setSentences(data.sentences)
          setLoading(false)
        } else if (retryCount < 3) {
          setTimeout(() => loadImages(retryCount + 1), 1000)
        } else {
          setLoading(false)
        }
      })
      .catch(() => {
        if (retryCount < 3) {
          setTimeout(() => loadImages(retryCount + 1), 1000)
        } else {
          setLoading(false)
        }
      })
  }, [])

  useEffect(() => {
    loadImages()
  }, [loadImages])

  const scrollYRef = useRef(0)

  // Lock the page and push a history entry so a single back gesture closes
  // whichever modal (image lightbox or type tester) the tile opened.
  const openTile = (tile: Tile) => {
    scrollYRef.current = window.scrollY
    lightboxOpenRef.current = true
    document.body.style.top = `-${scrollYRef.current}px`
    document.documentElement.classList.add('lightbox-open')
    if (tile.kind === 'font') setSelectedFont(tile)
    else setSelectedImage(tile)
    history.pushState({ lightbox: true }, '')
  }

  const closeModal = useCallback(() => {
    lightboxOpenRef.current = false
    document.documentElement.classList.remove('lightbox-open')
    document.body.style.top = ''
    setSelectedImage(null)
    setSelectedFont(null)
    requestAnimationFrame(() => {
      window.scrollTo(0, scrollYRef.current)
    })
  }, [])

  const closeLightbox = useCallback(() => {
    if (!lightboxOpenRef.current) return
    closeModal()
    history.back()
  }, [closeModal])

  useEffect(() => {
    const handlePopState = () => {
      if (lightboxOpenRef.current) closeModal()
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [closeModal])

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeLightbox()
    }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [closeLightbox])

  // Layout calculations
  const layout = useMemo(() => {
    const gap = typeof window !== 'undefined' && window.innerWidth <= 700 ? 16 : 24
    const padding = typeof window !== 'undefined'
      ? (window.innerWidth <= 500 ? 24 : window.innerWidth <= 700 ? 32 : window.innerWidth <= 900 ? 48 : 96)
      : 96
    const containerWidth = typeof window !== 'undefined' ? window.innerWidth - padding * 2 : 1200
    const itemSize = (containerWidth - gap * (columns - 1)) / columns
    const rowHeight = itemSize + gap
    const totalHeight = padding + 10000 * rowHeight
    return { gap, padding, itemSize, rowHeight, totalHeight }
  }, [columns])

  // Skeleton items for loading state
  const skeletonItems = useMemo(() => {
    const { padding, itemSize, rowHeight, gap } = layout
    const visibleRows = Math.ceil(windowHeight / rowHeight) + 1
    const items: { top: number; left: number; size: number }[] = []
    for (let row = 0; row < visibleRows; row++) {
      for (let col = 0; col < columns; col++) {
        items.push({
          top: padding + row * rowHeight,
          left: padding + col * (itemSize + gap),
          size: itemSize,
        })
      }
    }
    return items
  }, [layout, columns, windowHeight])

  // Virtual scrolling — derive from a deferred scrollTop so React can
  // skip stale recomputes when the user is actively scrolling fast.
  const deferredScrollTop = useDeferredValue(scrollTop)
  const virtualData = useMemo(() => {
    if (tiles.length === 0) return { items: [], totalHeight: layout.totalHeight }

    const { padding, itemSize, rowHeight, gap, totalHeight } = layout
    const startRow = Math.max(0, Math.floor((deferredScrollTop - padding) / rowHeight) - BUFFER_ROWS)
    const visibleRows = Math.ceil(windowHeight / rowHeight) + BUFFER_ROWS * 2
    const endRow = startRow + visibleRows

    const items: { tile: Tile; index: number; top: number; left: number; size: number }[] = []

    for (let row = startRow; row < endRow; row++) {
      for (let col = 0; col < columns; col++) {
        const index = row * columns + col
        const tile = tiles[index % tiles.length]
        items.push({
          tile,
          index,
          top: padding + row * rowHeight,
          left: padding + col * (itemSize + gap),
          size: itemSize,
        })
      }
    }

    return { items, totalHeight }
  }, [tiles, deferredScrollTop, columns, windowHeight, layout])

  return (
    <>
      <div style={{ height: layout.totalHeight, position: 'relative' }}>
        {loading
          ? skeletonItems.map((item, i) => (
              <div
                key={i}
                className="item"
                style={{
                  position: 'absolute',
                  top: item.top,
                  left: item.left,
                  width: item.size,
                  height: item.size,
                }}
              />
            ))
          : virtualData.items.map(({ tile, index, top, left, size }) =>
              tile.kind === 'font' ? (
                <FontItem
                  key={`${tile.id}-${index}`}
                  tile={tile}
                  sentence={pickSentence(sentences, index)}
                  top={top}
                  left={left}
                  size={size}
                  onClick={() => openTile(tile)}
                />
              ) : (
                <VirtualItem
                  key={`${tile.id}-${index}`}
                  image={tile}
                  top={top}
                  left={left}
                  size={size}
                  onClick={() => openTile(tile)}
                />
              ),
            )}
      </div>

      {selectedImage && (
        <Lightbox
          url={selectedImage.url}
          onClose={closeLightbox}
        />
      )}

      {selectedFont && (
        <FontPreview
          tile={selectedFont}
          sentences={sentences}
          onClose={closeLightbox}
        />
      )}
    </>
  )
}

function VirtualItem({
  image,
  top,
  left,
  size,
  onClick
}: {
  image: ImageTile
  top: number
  left: number
  size: number
  onClick: () => void
}) {
  const [loaded, setLoaded] = useState(false)
  const [retryCount, setRetryCount] = useState(0)

  const handleError = () => {
    if (retryCount < 2) {
      setTimeout(() => setRetryCount(r => r + 1), 1000)
    }
  }

  return (
    <div
      className="item"
      onClick={onClick}
      style={{
        position: 'absolute',
        top,
        left,
        width: size,
        height: size,
      }}
    >
      <img
        key={retryCount}
        src={image.url}
        alt=""
        loading="lazy"
        decoding="async"
        style={{
          position: 'absolute',
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          opacity: loaded ? 1 : 0,
          transition: 'opacity 0.3s ease'
        }}
        onLoad={() => setLoaded(true)}
        onError={handleError}
      />
    </div>
  )
}

// A typeface tile — renders a sample sentence set in the font.
function FontItem({
  tile,
  sentence,
  top,
  left,
  size,
  onClick,
}: {
  tile: FontTile
  sentence: string
  top: number
  left: number
  size: number
  onClick: () => void
}) {
  const family = fontFamilyFor(tile.id)

  useEffect(() => {
    ensureFontFace(family, representativeStyle(tile).url)
  }, [family, tile])

  return (
    <div
      className="item font-item"
      onClick={onClick}
      style={{ position: 'absolute', top, left, width: size, height: size }}
    >
      <div
        className="font-sentence"
        style={{
          fontFamily: `'${family}', sans-serif`,
          // Variable fonts render the specimen bold; static fonts ignore it.
          fontVariationSettings: '"wght" 700',
          fontWeight: 700,
          fontSize: Math.round(size * 0.085),
          padding: Math.round(size * 0.12),
        }}
      >
        {sentence}
      </div>
    </div>
  )
}

// A comfortable, viewport-relative preview size. The type size is fixed —
// the cursor only changes weight and width.
function previewFontSize(): number {
  if (typeof window === 'undefined') return 160
  return Math.round(Math.min(200, Math.max(64, window.innerWidth / 6)))
}

// Interactive type tester. The cursor is the control surface: horizontal
// position sets the weight (light at the left edge, heavy at the right),
// vertical position sets the width. The real cursor is hidden and replaced
// by a label — clicking the left half of the screen shows the previous CMS
// sentence, the right half shows the next.
function FontPreview({
  tile,
  sentences,
  onClose,
}: {
  tile: FontTile
  sentences: string[]
  onClose: () => void
}) {
  const pool = useMemo(
    () => (sentences.length ? sentences : ['Type something']),
    [sentences],
  )

  const initialIndex = useMemo(() => {
    const i = tile.styles.findIndex(s => /regular|book|normal|text/i.test(s.style))
    return i === -1 ? 0 : i
  }, [tile])

  const startSentenceRef = useRef(Math.floor(Math.random() * pool.length))
  const [styleIndex, setStyleIndex] = useState(initialIndex)
  const [sentenceIndex, setSentenceIndex] = useState(startSentenceRef.current)
  const [text, setText] = useState(pool[startSentenceRef.current] ?? 'Type something')
  const [size, setSize] = useState(previewFontSize)
  const [axisValues, setAxisValues] = useState<Record<string, number>>({})
  const [family, setFamily] = useState('')
  const axesRef = useRef<Axis[]>([])
  const bufCache = useRef<Map<string, ArrayBuffer>>(new Map())
  const taRef = useRef<HTMLTextAreaElement>(null)
  const cursorRef = useRef<HTMLDivElement>(null)

  // Load the selected style: fetch the bytes, register a FontFace keyed by
  // the file id, and parse any variable-font axes from the same buffer.
  useEffect(() => {
    let cancelled = false
    const file = tile.styles[styleIndex]
    if (!file) return
    const fam = 'tp-' + file.id.replace(/[^a-zA-Z0-9]/g, '-')

    const apply = (buf: ArrayBuffer) => {
      if (cancelled) return
      const parsed = parseVariationAxes(buf)
      axesRef.current = parsed
      setAxisValues(Object.fromEntries(parsed.map(a => [a.tag, a.default])))
      setFamily(fam)
    }

    const cached = bufCache.current.get(file.id)
    if (cached) {
      apply(cached)
      return () => { cancelled = true }
    }

    fetch(file.url)
      .then(r => r.arrayBuffer())
      .then(buf => {
        bufCache.current.set(file.id, buf)
        const ff = new FontFace(fam, buf)
        return ff.load().then(loaded => {
          if (cancelled) return
          document.fonts.add(loaded)
          apply(buf)
        })
      })
      .catch(() => { if (!cancelled) setFamily(fam) })

    return () => { cancelled = true }
  }, [tile, styleIndex])

  // Cursor drives the variable axes and the custom cursor label. Horizontal
  // position sets the weight (light -> heavy), vertical sets the width. The
  // type size stays fixed. rAF-coalesced to one update per frame.
  useEffect(() => {
    let raf = 0
    let cx = window.innerWidth / 2
    let cy = window.innerHeight / 2
    const update = () => {
      raf = 0
      const nx = Math.min(1, Math.max(0, cx / window.innerWidth))
      const ny = Math.min(1, Math.max(0, cy / window.innerHeight))
      const wght = axesRef.current.find(a => a.tag === 'wght')
      const wdth = axesRef.current.find(a => a.tag === 'wdth')
      if (wght || wdth) {
        setAxisValues(v => {
          const next = { ...v }
          if (wght) next.wght = wght.min + (wght.max - wght.min) * nx
          if (wdth) next.wdth = wdth.min + (wdth.max - wdth.min) * ny
          return next
        })
      }
      const cursor = cursorRef.current
      if (cursor) {
        cursor.style.transform = `translate(${cx}px, ${cy}px) translate(-50%, -50%)`
        cursor.textContent = nx < 0.5 ? 'previous string' : 'next string'
      }
    }
    const move = (x: number, y: number) => {
      cx = x
      cy = y
      if (!raf) raf = requestAnimationFrame(update)
    }
    const onMouse = (e: MouseEvent) => move(e.clientX, e.clientY)
    const onTouch = (e: TouchEvent) => {
      if (e.touches[0]) move(e.touches[0].clientX, e.touches[0].clientY)
    }
    const onResize = () => setSize(previewFontSize())
    window.addEventListener('mousemove', onMouse)
    window.addEventListener('touchmove', onTouch, { passive: true })
    window.addEventListener('resize', onResize)
    update() // seed the cursor label before the first move
    return () => {
      window.removeEventListener('mousemove', onMouse)
      window.removeEventListener('touchmove', onTouch)
      window.removeEventListener('resize', onResize)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  const variationSettings = axesRef.current.length
    ? axesRef.current.map(a => `"${a.tag}" ${axisValues[a.tag] ?? a.default}`).join(', ')
    : undefined

  // Grow the textarea to fit its content as text / size / axes change.
  useLayoutEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = ta.scrollHeight + 'px'
  }, [text, size, family, variationSettings])

  const cycle = (dir: number) => {
    const n = (sentenceIndex + dir + pool.length) % pool.length
    setSentenceIndex(n)
    setText(pool[n])
  }

  // The left half of the screen goes to the previous sentence, the right
  // half to the next. The close button and style controls are excluded.
  const handleClick = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement
    if (t.closest('.font-preview-controls') || t.closest('.font-preview-close')) return
    cycle(e.clientX < window.innerWidth / 2 ? -1 : 1)
  }

  return (
    <div className="font-preview" onClick={handleClick}>
      <button
        type="button"
        className="font-preview-close"
        onClick={onClose}
        aria-label="Close"
      >×</button>

      <div className="font-preview-stage">
        <textarea
          ref={taRef}
          className="font-preview-text"
          value={text}
          onChange={e => setText(e.target.value)}
          spellCheck={false}
          autoFocus
          rows={1}
          style={{
            fontFamily: family ? `'${family}', sans-serif` : 'sans-serif',
            fontSize: size,
            fontVariationSettings: variationSettings,
          }}
        />
      </div>

      {tile.styles.length > 1 && (
        <div className="font-preview-controls">
          <div className="font-preview-styles">
            {tile.styles.map((s, i) => (
              <button
                key={s.id}
                type="button"
                className={`font-preview-style${i === styleIndex ? ' is-active' : ''}`}
                onClick={() => setStyleIndex(i)}
              >
                {s.style}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Text content is set imperatively in the cursor effect so a
          re-render can't reset the previous/next label. */}
      <div
        ref={cursorRef}
        className="font-cursor"
        aria-hidden="true"
        style={{ transform: 'translate(50vw, 50vh) translate(-50%, -50%)' }}
      />
    </div>
  )
}

function Lightbox({ url, onClose }: { url: string | null; onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const scaleRef = useRef(1)
  const fitScaleRef = useRef(1)
  const posRef = useRef({ x: 0, y: 0 })
  const isDraggingRef = useRef(false)
  const [isDragging, setIsDragging] = useState(false)
  const didDragRef = useRef(false)
  const downPosRef = useRef({ x: 0, y: 0 })
  const dragStartRef = useRef({ x: 0, y: 0 })
  const pinchRef = useRef<{ dist: number; scale: number; midX: number; midY: number; posX: number; posY: number } | null>(null)
  const lastTapRef = useRef(0)

  const applyTransform = useCallback((pos: { x: number; y: number }, s: number, animated = false) => {
    posRef.current = pos
    scaleRef.current = s
    if (imageRef.current) {
      imageRef.current.style.transition = animated ? 'transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)' : 'none'
      imageRef.current.style.transform = `translate(${pos.x}px, ${pos.y}px) scale(${s})`
    }
  }, [])

  // On image load: calculate fit scale from natural dimensions
  const handleImageLoad = useCallback(() => {
    if (!imageRef.current) return
    const { naturalWidth, naturalHeight } = imageRef.current
    const vw = window.innerWidth
    const vh = window.innerHeight
    const fit = Math.min(vw / naturalWidth, vh / naturalHeight)
    fitScaleRef.current = fit
    applyTransform({ x: 0, y: 0 }, fit)
  }, [applyTransform])

  // Reset state when url changes
  useEffect(() => {
    fitScaleRef.current = 1
    applyTransform({ x: 0, y: 0 }, 1)
  }, [url, applyTransform])

  // Wheel zoom + block passive touchmove
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      const base = e.ctrlKey ? 0.97 : 0.999
      const factor = Math.pow(base, e.deltaY)
      const newScale = Math.min(Math.max(scaleRef.current * factor, fitScaleRef.current), 20)
      const cx = window.innerWidth / 2
      const cy = window.innerHeight / 2
      const ratio = newScale / scaleRef.current
      applyTransform({
        x: (e.clientX - cx) * (1 - ratio) + posRef.current.x * ratio,
        y: (e.clientY - cy) * (1 - ratio) + posRef.current.y * ratio,
      }, newScale)
    }
    const block = (e: TouchEvent) => e.preventDefault()
    const container = containerRef.current
    if (container) {
      container.addEventListener('wheel', handleWheel, { passive: false })
      container.addEventListener('touchmove', block, { passive: false })
    }
    return () => {
      if (container) {
        container.removeEventListener('wheel', handleWheel)
        container.removeEventListener('touchmove', block)
      }
    }
  }, [applyTransform])

  // Double click
  const handleDoubleClick = useCallback(() => {
    if (scaleRef.current > fitScaleRef.current * 1.05) applyTransform({ x: 0, y: 0 }, fitScaleRef.current, true)
    else applyTransform(posRef.current, fitScaleRef.current * 3, true)
  }, [applyTransform])

  // Mouse
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    didDragRef.current = false
    downPosRef.current = { x: e.clientX, y: e.clientY }
    isDraggingRef.current = true
    setIsDragging(true)
    dragStartRef.current = { x: e.clientX - posRef.current.x, y: e.clientY - posRef.current.y }
  }, [])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (Math.abs(e.clientX - downPosRef.current.x) > 5 || Math.abs(e.clientY - downPosRef.current.y) > 5)
      didDragRef.current = true
    if (isDraggingRef.current)
      applyTransform({ x: e.clientX - dragStartRef.current.x, y: e.clientY - dragStartRef.current.y }, scaleRef.current)
  }, [applyTransform])

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false
    setIsDragging(false)
    if (!didDragRef.current) onClose()
  }, [onClose])

  // Touch
  const pinchDist = (t: React.TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      didDragRef.current = false
      downPosRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
      dragStartRef.current = { x: e.touches[0].clientX - posRef.current.x, y: e.touches[0].clientY - posRef.current.y }
    } else if (e.touches.length === 2) {
      didDragRef.current = true
      pinchRef.current = {
        dist: pinchDist(e.touches),
        scale: scaleRef.current,
        midX: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        midY: (e.touches[0].clientY + e.touches[1].clientY) / 2,
        posX: posRef.current.x,
        posY: posRef.current.y,
      }
    }
  }, [])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchRef.current) {
      const p = pinchRef.current
      const newScale = Math.min(Math.max(p.scale * (pinchDist(e.touches) / p.dist), fitScaleRef.current), 20)
      const curMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2
      const curMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2
      const cx = window.innerWidth / 2
      const cy = window.innerHeight / 2
      const ratio = newScale / p.scale
      applyTransform({
        x: (p.midX - cx) * (1 - ratio) + p.posX * ratio + (curMidX - p.midX),
        y: (p.midY - cy) * (1 - ratio) + p.posY * ratio + (curMidY - p.midY),
      }, newScale)
    } else if (e.touches.length === 1) {
      if (Math.abs(e.touches[0].clientX - downPosRef.current.x) > 5 || Math.abs(e.touches[0].clientY - downPosRef.current.y) > 5)
        didDragRef.current = true
      applyTransform({ x: e.touches[0].clientX - dragStartRef.current.x, y: e.touches[0].clientY - dragStartRef.current.y }, scaleRef.current)
    }
  }, [applyTransform])

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    e.preventDefault()
    // Transition from pinch to single-finger pan — update anchor
    if (e.touches.length === 1) {
      pinchRef.current = null
      dragStartRef.current = { x: e.touches[0].clientX - posRef.current.x, y: e.touches[0].clientY - posRef.current.y }
      return
    }
    pinchRef.current = null
    if (didDragRef.current) return
    const now = Date.now()
    if (now - lastTapRef.current < 300) {
      lastTapRef.current = 0
      if (scaleRef.current > fitScaleRef.current * 1.05) applyTransform({ x: 0, y: 0 }, fitScaleRef.current, true)
      else applyTransform(posRef.current, fitScaleRef.current * 3, true)
    } else {
      lastTapRef.current = now
      setTimeout(() => { if (lastTapRef.current === now) onClose() }, 300)
    }
  }, [onClose, applyTransform])

  return (
    <div
      ref={containerRef}
      className="lightbox"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onDoubleClick={handleDoubleClick}
      style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
    >
      {url ? (
        <img
          ref={imageRef}
          src={url}
          alt=""
          className="lightbox-image"
          draggable={false}
          onLoad={handleImageLoad}
          style={{ pointerEvents: 'none', willChange: 'transform' }}
        />
      ) : (
        <div className="lightbox-loading" />
      )}
    </div>
  )
}
