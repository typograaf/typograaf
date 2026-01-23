'use client'

import { useEffect, useState } from 'react'

interface Image {
  id: string
  name: string
  thumb: string
  full: string
  modified: string
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

  if (loading) {
    return <div className="loading" />
  }

  return (
    <>
      <div className="feed">
        {images.map((image) => (
          <div key={image.id} className="item" onClick={() => setSelectedImage(image)}>
            <img src={image.thumb} alt="" loading="lazy" />
          </div>
        ))}
      </div>

      {selectedImage && (
        <div className="lightbox" onClick={() => setSelectedImage(null)}>
          <img src={selectedImage.full} alt="" />
        </div>
      )}
    </>
  )
}
