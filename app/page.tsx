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
    const handleScroll = () => {
      if (!lightboxOpenRef.current) {
        setScrollTop(window.scrollY)
      }
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  // Preload the open icon
  useEffect(() => {
    const link = document.createElement('link')
    link.rel = 'preload'
    link.as = 'image'
    link.href = '/icon-open.png'
    document.head.appendChild(link)
  }, [])

  const loadImages = useCallback((retryCount = 0) => {
    setLoading(true)
    fetch(`/api/images?t=${Date.now()}`)
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


  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModal()
    }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [closeModal])

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
      <img
        src={showInfo ? "/icon-open.png" : "/icon.png"}
        alt=""
        className={showInfo ? "logo logo-open" : "logo"}
        onClick={() => setShowInfo(!showInfo)}
      />
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
          onClose={closeModal}
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
        crossOrigin="anonymous"
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
  const [scale, setScale] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement>(null)
  const didDragRef = useRef(false)
  const mouseDownPosRef = useRef({ x: 0, y: 0 })

  // Handle zoom wheel
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      const delta = e.deltaY > 0 ? 0.9 : 1.1
      setScale(s => Math.min(Math.max(s * delta, 1), 5))
    }

    const container = containerRef.current
    if (container) {
      container.addEventListener('wheel', handleWheel, { passive: false })
    }

    return () => {
      if (container) {
        container.removeEventListener('wheel', handleWheel)
      }
    }
  }, [])

  // Reset on new image
  useEffect(() => {
    setScale(1)
    setPosition({ x: 0, y: 0 })
  }, [url])


  // Double click to zoom/reset
  const handleDoubleClick = useCallback(() => {
    if (scale > 1) {
      setScale(1)
      setPosition({ x: 0, y: 0 })
    } else {
      setScale(2.5)
    }
  }, [scale])

  // Mouse drag for panning
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    didDragRef.current = false
    mouseDownPosRef.current = { x: e.clientX, y: e.clientY }
    setIsDragging(true)
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y })
  }, [position])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const dx = Math.abs(e.clientX - mouseDownPosRef.current.x)
    const dy = Math.abs(e.clientY - mouseDownPosRef.current.y)
    if (dx > 5 || dy > 5) {
      didDragRef.current = true
    }
    if (isDragging) {
      setPosition({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      })
    }
  }, [isDragging, dragStart])

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
    if (!didDragRef.current) {
      onClose()
    }
  }, [onClose])

  // Simple touch handling - tap to close, no zoom/pan on mobile
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      didDragRef.current = false
      mouseDownPosRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    }
  }, [])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      const dx = Math.abs(e.touches[0].clientX - mouseDownPosRef.current.x)
      const dy = Math.abs(e.touches[0].clientY - mouseDownPosRef.current.y)
      if (dx > 5 || dy > 5) {
        didDragRef.current = true
      }
    }
  }, [])

  const handleTouchEnd = useCallback(() => {
    if (!didDragRef.current) {
      onClose()
    }
  }, [onClose])

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
          src={url}
          alt=""
          crossOrigin="anonymous"
          className="lightbox-image"
          draggable={false}
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
            transition: isDragging ? 'none' : 'transform 0.2s ease',
            pointerEvents: 'none'
          }}
        />
      ) : (
        <div className="lightbox-loading" />
      )}
    </div>
  )
}
