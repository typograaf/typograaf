'use client'

import { useEffect, useLayoutEffect, useState, useCallback, useRef, useMemo } from 'react'

interface ImageData {
  id: string
  url: string
  path: string
}

const SKELETON_COUNT = 40
const BUFFER_ROWS = 3

export default function Home() {
  const [images, setImages] = useState<ImageData[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedImage, setSelectedImage] = useState<ImageData | null>(null)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const [showInfo, setShowInfo] = useState(false)
  const [scrollTop, setScrollTop] = useState(0)
  const [columns, setColumns] = useState(8)
  const [windowHeight, setWindowHeight] = useState(800)
  const [isScrolling, setIsScrolling] = useState(false)
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

  // Track scroll position (but not when lightbox is open)
  const lightboxOpenRef = useRef(false)
  useEffect(() => {
    let scrollTimeout: ReturnType<typeof setTimeout> | null = null
    const handleScroll = () => {
      if (!lightboxOpenRef.current) {
        setScrollTop(window.scrollY)
      }
      setIsScrolling(true)
      if (scrollTimeout) clearTimeout(scrollTimeout)
      scrollTimeout = setTimeout(() => setIsScrolling(false), 220)
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', handleScroll)
      if (scrollTimeout) clearTimeout(scrollTimeout)
    }
  }, [])

  // Preload icon layers
  useEffect(() => {
    ;['/icon-back.png', '/icon-middle.png', '/icon-front.png'].forEach((href) => {
      const link = document.createElement('link')
      link.rel = 'preload'
      link.as = 'image'
      link.href = href
      document.head.appendChild(link)
    })
  }, [])

  const loadImages = useCallback((retryCount = 0) => {
    setLoading(true)
    fetch('/api/images')
      .then(res => res.json())
      .then(data => {
        if (data.images && data.images.length > 0) {
          setImages(data.images)
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

  const openLightbox = (image: ImageData) => {
    scrollYRef.current = window.scrollY
    lightboxOpenRef.current = true
    document.body.style.top = `-${scrollYRef.current}px`
    document.documentElement.classList.add('lightbox-open')
    setSelectedImage(image)
    setLightboxUrl(image.url)
    history.pushState({ lightbox: true }, '')
  }

  const closeModal = useCallback(() => {
    lightboxOpenRef.current = false
    document.documentElement.classList.remove('lightbox-open')
    document.body.style.top = ''
    setSelectedImage(null)
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

  // Virtual scrolling calculations
  const virtualData = useMemo(() => {
    if (images.length === 0) return { items: [], totalHeight: layout.totalHeight }

    const { padding, itemSize, rowHeight, gap, totalHeight } = layout
    const startRow = Math.max(0, Math.floor((scrollTop - padding) / rowHeight) - BUFFER_ROWS)
    const visibleRows = Math.ceil(windowHeight / rowHeight) + BUFFER_ROWS * 2
    const endRow = startRow + visibleRows

    const items: { image: ImageData; index: number; top: number; left: number; size: number }[] = []

    for (let row = startRow; row < endRow; row++) {
      for (let col = 0; col < columns; col++) {
        const index = row * columns + col
        const image = images[index % images.length]
        items.push({
          image,
          index,
          top: padding + row * rowHeight,
          left: padding + col * (itemSize + gap),
          size: itemSize,
        })
      }
    }

    return { items, totalHeight }
  }, [images, scrollTop, columns, windowHeight, layout])

  return (
    <>
      <div
        className={`logo${showInfo ? ' logo-open' : ''}${!showInfo && isScrolling ? ' logo-peek' : ''}`}
        onClick={() => setShowInfo(!showInfo)}
        role="button"
        aria-label={showInfo ? 'Hide contact info' : 'Show contact info'}
      >
        <img src="/icon-back.png" alt="" className="logo-layer logo-back" />
        <img src="/icon-middle.png" alt="" className="logo-layer logo-middle" />
        <img src="/icon-front.png" alt="" className="logo-layer logo-front" />
      </div>
      {showInfo && (
        <div className="info">
          <p><a href="tel:+32493459296">t. +32 (0) 493 45 92 96</a></p>
          <p><a href="mailto:hello@typografie.be">m. hello@typografie.be</a></p>
          <p><a href="https://instagram.com/typograaf" target="_blank" rel="noopener noreferrer">i. @typograaf</a></p>
        </div>
      )}
      {!showInfo && (
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
            : virtualData.items.map(({ image, index, top, left, size }) => (
                <VirtualItem
                  key={`${image.id}-${index}`}
                  image={image}
                  top={top}
                  left={left}
                  size={size}
                  onClick={() => openLightbox(image)}
                />
              ))}
        </div>
      )}

      {selectedImage && (
        <Lightbox
          url={lightboxUrl}
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
  image: ImageData
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
