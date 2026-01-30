'use client'

import { useEffect, useState, useCallback, useRef } from 'react'

interface ImageData {
  id: string
  url: string
  path: string
}

function LazyImage({ image, onClick, eager }: { image: ImageData; onClick: () => void; eager?: boolean }) {
  const [loaded, setLoaded] = useState(false)
  const [shouldLoad, setShouldLoad] = useState(eager || false)
  const [retryCount, setRetryCount] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (eager || shouldLoad) return

    // Use IntersectionObserver for lazy loading
    if (!('IntersectionObserver' in window)) {
      setShouldLoad(true)
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShouldLoad(true)
          observer.disconnect()
        }
      },
      { rootMargin: '500px' }
    )

    if (ref.current) observer.observe(ref.current)

    // Fallback: always load after 1 second
    const fallback = setTimeout(() => setShouldLoad(true), 1000)

    return () => {
      observer.disconnect()
      clearTimeout(fallback)
    }
  }, [eager, shouldLoad])

  // Retry on error (up to 2 times)
  const handleError = () => {
    if (retryCount < 2) {
      setTimeout(() => setRetryCount(r => r + 1), 1000)
    }
  }

  return (
    <div ref={ref} className="item" onClick={onClick}>
      {shouldLoad && (
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
      )}
    </div>
  )
}

// Skeleton placeholder count (approximate grid items visible on load)
const SKELETON_COUNT = 40
const INITIAL_COUNT = 40
const LOAD_MORE_COUNT = 40

export default function Home() {
  const [images, setImages] = useState<ImageData[]>([])
  const [loading, setLoading] = useState(true)
  const [visibleCount, setVisibleCount] = useState(INITIAL_COUNT)
  const [selectedImage, setSelectedImage] = useState<ImageData | null>(null)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const [showInfo, setShowInfo] = useState(false)
  const loaderRef = useRef<HTMLDivElement>(null)

  // Preload the open icon immediately
  useEffect(() => {
    const link = document.createElement('link')
    link.rel = 'preload'
    link.as = 'image'
    link.href = '/icon-open.png'
    document.head.appendChild(link)
  }, [])

  // Infinite scroll - load more when reaching bottom (loops forever)
  useEffect(() => {
    if (loading || images.length === 0) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisibleCount(v => v + LOAD_MORE_COUNT)
        }
      },
      { rootMargin: '200px' }
    )

    if (loaderRef.current) observer.observe(loaderRef.current)
    return () => observer.disconnect()
  }, [loading, images.length, visibleCount])

  const openLightbox = (image: ImageData) => {
    setSelectedImage(image)
    setLightboxUrl(image.url) // Use existing URL directly - no extra API call
  }

  const loadImages = useCallback((retryCount = 0) => {
    setLoading(true)
    // Add cache buster to force fresh data
    fetch(`/api/images?t=${Date.now()}`)
      .then(res => res.json())
      .then(data => {
        if (data.images && data.images.length > 0) {
          setImages(data.images)
          setLoading(false)
        } else if (retryCount < 3) {
          // Auto-retry up to 3 times
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

  const closeModal = useCallback(() => setSelectedImage(null), [])

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModal()
    }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [closeModal])

  return (
    <>
      <img src={showInfo ? "/icon-open.png" : "/icon.png"} alt="" className={showInfo ? "logo logo-open" : "logo"} onClick={() => setShowInfo(!showInfo)} />
      {showInfo && (
        <div className="info">
          <p><a href="tel:+32493459296">t. +32 (0) 493 45 92 96</a></p>
          <p><a href="mailto:hello@typografie.be">m. hello@typografie.be</a></p>
          <p><a href="https://instagram.com/typograaf" target="_blank" rel="noopener noreferrer">i. @typograaf</a></p>
        </div>
      )}
      {!showInfo && (
        <>
          <div className="feed">
            {loading
              ? Array.from({ length: SKELETON_COUNT }).map((_, i) => (
                  <div key={i} className="item" />
                ))
              : Array.from({ length: visibleCount }).map((_, index) => {
                  const image = images[index % images.length]
                  return (
                    <LazyImage
                      key={`${image.id}-${index}`}
                      image={image}
                      onClick={() => openLightbox(image)}
                      eager={index < INITIAL_COUNT}
                    />
                  )
                })}
          </div>
          {!loading && images.length > 0 && (
            <div ref={loaderRef} className="loader">
              <div className="spinner" />
            </div>
          )}
        </>
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
