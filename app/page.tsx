'use client'

import { useEffect, useState } from 'react'

interface Image {
  id: string
  name: string
  url: string
  modified: string
}

export default function Home() {
  const [images, setImages] = useState<Image[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedImage, setSelectedImage] = useState<Image | null>(null)

  useEffect(() => {
    fetchImages()
  }, [])

  async function fetchImages() {
    try {
      const res = await fetch('/api/images')
      const data = await res.json()

      if (data.error) {
        setError(data.error)
      } else {
        setImages(data.images)
      }
    } catch {
      setError('Failed to load images')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="container">
        <header>
          <h1>Typograaf</h1>
        </header>
        <div className="loading">Loading...</div>
      </div>
    )
  }

  if (error === 'DROPBOX_ACCESS_TOKEN not configured') {
    return (
      <div className="container">
        <header>
          <h1>Typograaf</h1>
        </header>
        <div className="setup-notice">
          <h2>Setup Required</h2>
          <p>Connect your Dropbox to display images:</p>
          <ol>
            <li>Go to <a href="https://www.dropbox.com/developers/apps" target="_blank">Dropbox Developer Console</a></li>
            <li>Create a new app with &quot;Scoped access&quot; and &quot;Full Dropbox&quot;</li>
            <li>Under Permissions, enable <code>files.metadata.read</code> and <code>files.content.read</code></li>
            <li>Generate an access token</li>
            <li>Create a <code>.env.local</code> file with:
              <pre style={{ marginTop: '0.5rem', padding: '1rem', background: '#2a2a2a', borderRadius: '4px' }}>
{`DROPBOX_ACCESS_TOKEN=your_token_here
DROPBOX_FOLDER_PATH=/YourFolderName`}
              </pre>
            </li>
            <li>Restart the dev server</li>
          </ol>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="container">
        <header>
          <h1>Typograaf</h1>
        </header>
        <div className="error">
          <p>{error}</p>
          <button onClick={() => { setLoading(true); setError(null); fetchImages(); }} style={{ marginTop: '1rem', padding: '0.5rem 1rem', cursor: 'pointer' }}>
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="container">
      <header>
        <h1>Typograaf</h1>
      </header>

      {images.length === 0 ? (
        <p style={{ color: '#666' }}>No images found. Add images to your Dropbox folder.</p>
      ) : (
        <div className="gallery">
          {images.map((image) => (
            <div
              key={image.id}
              className="gallery-item"
              onClick={() => setSelectedImage(image)}
            >
              <img src={image.url} alt={image.name} loading="lazy" />
              <div className="overlay">
                <span>{image.name}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedImage && (
        <div className="lightbox" onClick={() => setSelectedImage(null)}>
          <img src={selectedImage.url} alt={selectedImage.name} />
        </div>
      )}
    </div>
  )
}
