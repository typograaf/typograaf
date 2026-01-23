'use client'

import { useEffect, useState, useCallback } from 'react'
import Image from 'next/image'

interface ImageData {
  id: string
  url: string
}

export default function Home() {
  const [images, setImages] = useState<ImageData[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedImage, setSelectedImage] = useState<ImageData | null>(null)
  const [loadedImages, setLoadedImages] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetch('/api/images')
      .then(res => res.json())
      .then(data => {
        if (data.images) setImages(data.images)
      })
      .finally(() => setLoading(false))
  }, [])

  const closeModal = useCallback(() => setSelectedImage(null), [])

  const handleImageLoad = useCallback((id: string) => {
    setLoadedImages(prev => new Set(prev).add(id))
  }, [])

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
          <div
            key={image.id}
            className="item"
            onClick={() => setSelectedImage(image)}
          >
            <Image
              src={image.url}
              alt=""
              fill
              sizes="(max-width: 500px) 50vw, (max-width: 700px) 33vw, (max-width: 900px) 25vw, (max-width: 1100px) 20vw, (max-width: 1400px) 16vw, (max-width: 1600px) 14vw, 12.5vw"
              style={{ objectFit: 'contain' }}
              loading="lazy"
              data-loaded={loadedImages.has(image.id)}
              onLoad={() => handleImageLoad(image.id)}
            />
          </div>
        ))}
      </div>

      {selectedImage && (
        <div className="lightbox" onClick={closeModal}>
          <Image
            src={selectedImage.url}
            alt=""
            fill
            sizes="100vw"
            style={{ objectFit: 'contain' }}
            priority
          />
        </div>
      )}
    </>
  )
}
