'use client'

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'

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

  // Calculate columns based on window width
  useEffect(() => {
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

  // Scroll to top on mount
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  // Track scroll position
  useEffect(() => {
    const handleScroll = () => setScrollTop(window.scrollY)
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

  const openLightbox = (image: ImageData) => {
    setSelectedImage(image)
    setLightboxUrl(image.url)
  }

  const closeModal = useCallback(() => setSelectedImage(null), [])

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModal()
    }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [closeModal])

  // Virtual scrolling calculations
  const virtualData = useMemo(() => {
    if (images.length === 0) return { items: [], totalHeight: 0 }

    const gap = typeof window !== 'undefined' && window.innerWidth <= 700 ? 16 : 24
    const padding = typeof window !== 'undefined'
      ? (window.innerWidth <= 500 ? 24 : window.innerWidth <= 700 ? 32 : window.innerWidth <= 900 ? 48 : 96)
      : 96
    const containerWidth = typeof window !== 'undefined' ? window.innerWidth - padding * 2 : 1200
    const itemSize = (containerWidth - gap * (columns - 1)) / columns
    const rowHeight = itemSize + gap

    // Infinite height (effectively)
    const totalRows = 10000
    const totalHeight = padding + totalRows * rowHeight

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
  }, [images, scrollTop, columns, windowHeight])

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
        <div style={{ height: virtualData.totalHeight, position: 'relative' }}>
          {loading
            ? Array.from({ length: SKELETON_COUNT }).map((_, i) => (
                <div key={i} className="item" />
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
        <div className="lightbox" onClick={closeModal}>
          {lightboxUrl ? (
            <img
              src={lightboxUrl}
              alt=""
              crossOrigin="anonymous"
              className="lightbox-image"
            />
          ) : (
            <div className="lightbox-loading" />
          )}
        </div>
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
