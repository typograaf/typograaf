'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import Image from 'next/image'

interface ImageData {
  id: string
  url: string
  path: string
}

function LazyImage({ image, onClick }: { image: ImageData; onClick: () => void }) {
  const [loaded, setLoaded] = useState(false)
  const [shouldLoad, setShouldLoad] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Start loading immediately on mobile or if IntersectionObserver isn't supported
    if (!('IntersectionObserver' in window)) {
      setShouldLoad(true)
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShouldLoad(true)
          observer.disconnect() // Once visible, always load
        }
      },
      { rootMargin: '500px' } // Larger margin for better preloading
    )

    if (ref.current) observer.observe(ref.current)

    // Fallback: load after 2 seconds if observer hasn't triggered
    const fallback = setTimeout(() => setShouldLoad(true), 2000)

    return () => {
      observer.disconnect()
      clearTimeout(fallback)
    }
  }, [])

  return (
    <div ref={ref} className="item" onClick={onClick}>
      {shouldLoad && (
        <Image
          src={image.url}
          alt=""
          fill
          sizes="(max-width: 500px) 50vw, (max-width: 700px) 33vw, (max-width: 900px) 25vw, 200px"
          style={{ objectFit: 'contain', opacity: loaded ? 1 : 0, transition: 'opacity 0.3s ease' }}
          onLoad={() => setLoaded(true)}
          unoptimized
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

  // Preload the open icon immediately
  useEffect(() => {
    const link = document.createElement('link')
    link.rel = 'preload'
    link.as = 'image'
    link.href = '/icon-open.png'
    document.head.appendChild(link)
  }, [])

  const openLightbox = async (image: ImageData) => {
    setSelectedImage(image)
    setLightboxUrl(null)
    try {
      const res = await fetch(`/api/image?path=${encodeURIComponent(image.path)}`)
      const data = await res.json()
      if (data.url) setLightboxUrl(data.url)
    } catch {
      setLightboxUrl(image.url)
    }
  }

  useEffect(() => {
    fetch('/api/images')
      .then(res => res.json())
      .then(data => {
        if (data.images) setImages(data.images)
      })
      .finally(() => setLoading(false))
  }, [])

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
              : images.slice(0, visibleCount).map((image) => (
                  <LazyImage
                    key={image.id}
                    image={image}
                    onClick={() => openLightbox(image)}
                  />
                ))}
          </div>
          {!loading && visibleCount < images.length && (
            <button
              className="load-more"
              onClick={() => setVisibleCount(v => v + LOAD_MORE_COUNT)}
            >
              Load more
            </button>
          )}
        </>
      )}

      {selectedImage && (
        <div className="lightbox" onClick={closeModal}>
          {lightboxUrl ? (
            <img
              src={lightboxUrl}
              alt=""
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
