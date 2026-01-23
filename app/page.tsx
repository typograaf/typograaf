'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import Image from 'next/image'

interface ImageData {
  id: string
  url: string
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
          sizes="(max-width: 500px) 50vw, (max-width: 700px) 33vw, (max-width: 900px) 25vw, (max-width: 1100px) 20vw, (max-width: 1400px) 16vw, (max-width: 1600px) 14vw, 12.5vw"
          style={{ objectFit: 'contain', opacity: loaded ? 1 : 0, transition: 'opacity 0.3s ease' }}
          loading="lazy"
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
      <img src="/icon.png" alt="" className="logo" />
      <div className="feed">
        {images.map((image) => (
          <LazyImage
            key={image.id}
            image={image}
            onClick={() => setSelectedImage(image)}
          />
        ))}
      </div>

      {selectedImage && (
        <div className="lightbox" onClick={closeModal}>
          <img
            src={selectedImage.url}
            alt=""
            className="lightbox-image"
          />
        </div>
      )}
    </>
  )
}
