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
  const [inView, setInView] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        setInView(entry.isIntersecting)
      },
      { rootMargin: '100px' }
    )
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={ref} className="item" onClick={onClick}>
      {inView && (
        <Image
          src={image.url}
          alt=""
          fill
          sizes="200px"
          style={{ objectFit: 'contain', opacity: loaded ? 1 : 0, transition: 'opacity 0.3s ease' }}
          onLoad={() => setLoaded(true)}
        />
      )}
    </div>
  )
}

export default function Home() {
  const [images, setImages] = useState<ImageData[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedImage, setSelectedImage] = useState<ImageData | null>(null)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const [showInfo, setShowInfo] = useState(false)

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

  if (loading) {
    return <div className="loading" />
  }

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
        <div className="feed">
          {images.map((image) => (
            <LazyImage
              key={image.id}
              image={image}
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
