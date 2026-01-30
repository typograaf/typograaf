import { Dropbox, files } from 'dropbox'
import { NextResponse } from 'next/server'
import projectOrder from '../../../project-order.json'

// Cache for 30 minutes (Dropbox links last 4 hours)
export const revalidate = 1800

async function getAccessToken() {
  const refreshToken = process.env.DROPBOX_REFRESH_TOKEN
  const appKey = process.env.DROPBOX_APP_KEY
  const appSecret = process.env.DROPBOX_APP_SECRET

  if (!refreshToken || !appKey || !appSecret) {
    throw new Error('Dropbox credentials not configured')
  }

  const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: appKey,
      client_secret: appSecret,
    }),
  })

  const data = await response.json()
  if (!data.access_token) throw new Error('Failed to refresh token')
  return data.access_token
}

export async function GET() {
  const folderPath = process.env.DROPBOX_FOLDER_PATH || ''

  try {
    const accessToken = await getAccessToken()
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

      // Projects not in config go to the top (newest first)
      const orderA = indexA === -1 ? -1 : indexA
      const orderB = indexB === -1 ? -1 : indexB

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
          path: file.path_lower,
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
          'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200',
        },
      }
    )
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch images'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
