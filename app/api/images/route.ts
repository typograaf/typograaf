import { Dropbox, files } from 'dropbox'
import { NextResponse } from 'next/server'

// Cache for 5 minutes
export const revalidate = 300

export async function GET() {
  const accessToken = process.env.DROPBOX_ACCESS_TOKEN
  const folderPath = process.env.DROPBOX_FOLDER_PATH || ''

  if (!accessToken) {
    return NextResponse.json({ error: 'DROPBOX_ACCESS_TOKEN not configured' }, { status: 500 })
  }

  try {
    const dbx = new Dropbox({ accessToken, fetch })

    // Get all entries with pagination
    let allEntries: files.MetadataReference[] = []
    let response = await dbx.filesListFolder({ path: folderPath, recursive: true })
    allEntries = allEntries.concat(response.result.entries)

    while (response.result.has_more) {
      response = await dbx.filesListFolderContinue({ cursor: response.result.cursor })
      allEntries = allEntries.concat(response.result.entries)
    }

    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.avif']
    const imageFiles = allEntries.filter(
      (entry): entry is files.FileMetadataReference =>
        entry['.tag'] === 'file' &&
        imageExtensions.some(ext => entry.name.toLowerCase().endsWith(ext))
    )

    // Sort by modified date first
    const sortedFiles = imageFiles.sort((a, b) =>
      new Date(b.server_modified).getTime() - new Date(a.server_modified).getTime()
    )

    // Get thumbnails in batches of 25 (Dropbox limit)
    const batchSize = 25
    const images: { id: string; name: string; thumb: string; full: string; modified: string }[] = []

    for (let i = 0; i < sortedFiles.length; i += batchSize) {
      const batch = sortedFiles.slice(i, i + batchSize)

      // Get thumbnails
      const thumbEntries = batch
        .filter(f => !f.name.toLowerCase().endsWith('.gif') && !f.name.toLowerCase().endsWith('.avif'))
        .map(f => ({
          path: f.path_lower!,
          format: { '.tag': 'jpeg' as const },
          size: { '.tag': 'w256h256' as const },
          mode: { '.tag': 'fitone_bestfit' as const }
        }))

      let thumbMap: Record<string, string> = {}

      if (thumbEntries.length > 0) {
        try {
          const thumbResponse = await dbx.filesGetThumbnailBatch({ entries: thumbEntries })
          for (const entry of thumbResponse.result.entries) {
            if (entry['.tag'] === 'success') {
              const metadata = entry.metadata
              thumbMap[metadata.path_lower!] = `data:image/jpeg;base64,${entry.thumbnail}`
            }
          }
        } catch {
          // Fall back to full images if thumbnails fail
        }
      }

      // Get full image links for items without thumbnails and for lightbox
      const linksNeeded = batch.filter(f => !thumbMap[f.path_lower!])
      const linkPromises = linksNeeded.map(async (file) => {
        try {
          const linkResponse = await dbx.filesGetTemporaryLink({ path: file.path_lower! })
          return { path: file.path_lower!, url: linkResponse.result.link }
        } catch {
          return null
        }
      })

      const links = (await Promise.all(linkPromises)).filter(Boolean) as { path: string; url: string }[]
      const linkMap: Record<string, string> = {}
      for (const link of links) {
        linkMap[link.path] = link.url
      }

      // Also get full links for all images (for lightbox)
      const fullLinkPromises = batch.map(async (file) => {
        if (linkMap[file.path_lower!]) return { path: file.path_lower!, url: linkMap[file.path_lower!] }
        try {
          const linkResponse = await dbx.filesGetTemporaryLink({ path: file.path_lower! })
          return { path: file.path_lower!, url: linkResponse.result.link }
        } catch {
          return null
        }
      })

      const fullLinks = (await Promise.all(fullLinkPromises)).filter(Boolean) as { path: string; url: string }[]
      const fullLinkMap: Record<string, string> = {}
      for (const link of fullLinks) {
        fullLinkMap[link.path] = link.url
      }

      for (const file of batch) {
        const thumb = thumbMap[file.path_lower!] || linkMap[file.path_lower!] || fullLinkMap[file.path_lower!]
        const full = fullLinkMap[file.path_lower!]
        if (thumb && full) {
          images.push({
            id: file.id,
            name: file.name,
            thumb,
            full,
            modified: file.server_modified,
          })
        }
      }
    }

    return NextResponse.json({ images })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch images'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
