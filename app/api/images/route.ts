import { Dropbox, files } from 'dropbox'
import { NextResponse } from 'next/server'
import projectOrder from '../../../project-order.json'

// Revalidate every 60 seconds
export const revalidate = 60

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

    // Get project name from file path
    const getProjectName = (path: string) => {
      const parts = path.split('/')
      const baseDepth = folderPath.split('/').length
      return parts[baseDepth] || ''
    }

    // Sort images: by project order from config, then by filename within project
    const sortedFiles = imageFiles.sort((a, b) => {
      const projectA = getProjectName(a.path_lower!)
      const projectB = getProjectName(b.path_lower!)

      const indexA = projectOrder.findIndex(p => p.toLowerCase() === projectA)
      const indexB = projectOrder.findIndex(p => p.toLowerCase() === projectB)

      // Projects not in config go to the end
      const orderA = indexA === -1 ? 999 : indexA
      const orderB = indexB === -1 ? 999 : indexB

      if (orderA !== orderB) {
        return orderA - orderB
      }

      // Within same project, sort by filename
      return a.name.localeCompare(b.name)
    })

    // Get temporary links in parallel (batch of 50)
    const linkPromises = sortedFiles.map(async (file) => {
      try {
        const linkResponse = await dbx.filesGetTemporaryLink({ path: file.path_lower! })
        return {
          id: file.id,
          url: linkResponse.result.link,
        }
      } catch {
        return null
      }
    })

    const results = await Promise.all(linkPromises)
    const images = results.filter(Boolean)

    return NextResponse.json(
      { images },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
        },
      }
    )
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch images'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
