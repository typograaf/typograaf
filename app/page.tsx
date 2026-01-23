'use client'

import { useEffect, useState, useRef, useCallback } from 'react'

interface Image {
  id: string
  url: string
}

function LazyImage({ src, onClick }: { src: string; onClick: () => void }) {
  const [loaded, setLoaded] = useState(false)
  const [inView, setInView] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true)
          observer.disconnect()
        }
      },
      { rootMargin: '200px' }
    )
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={ref} className="item" onClick={onClick}>
      {inView && (
        <img
          src={src}
          alt=""
          decoding="async"
          onLoad={() => setLoaded(true)}
          style={{ opacity: loaded ? 1 : 0, transition: 'opacity 0.2s' }}
        />
      )}
    </div>
  )
}

export default function Home() {
  const [images, setImages] = useState<Image[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedImage, setSelectedImage] = useState<Image | null>(null)

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
      <div className="feed">
        {images.map((image) => (
          <LazyImage
            key={image.id}
            src={image.url}
            onClick={() => setSelectedImage(image)}
          />
        ))}
      </div>

      {selectedImage && (
        <div className="lightbox" onClick={closeModal}>
          <img src={selectedImage.url} alt="" />
        </div>
      )}
    </>
  )
}
