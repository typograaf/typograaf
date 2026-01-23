import { Dropbox } from 'dropbox'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

interface DropboxError {
  error?: {
    error_summary?: string
    [key: string]: unknown
  }
}

interface FileEntry {
  '.tag': 'file'
  id: string
  name: string
  path_lower?: string
  server_modified: string
}

interface FolderEntry {
  '.tag': 'folder'
  name: string
  path_lower?: string
}

type Entry = FileEntry | FolderEntry | { '.tag': string; name: string }

export async function GET() {
  const accessToken = process.env.DROPBOX_ACCESS_TOKEN
  const folderPath = process.env.DROPBOX_FOLDER_PATH || ''

  if (!accessToken) {
    return NextResponse.json(
      { error: 'DROPBOX_ACCESS_TOKEN not configured' },
      { status: 500 }
    )
  }

  try {
    const dbx = new Dropbox({ accessToken, fetch })

    // First get the list without recursive to see immediate contents
    const response = await dbx.filesListFolder({
      path: folderPath,
      recursive: true,
      limit: 2000
    })

    const allEntries = response.result.entries as Entry[]
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']
    const imageFiles = allEntries.filter(
      (entry): entry is FileEntry =>
        entry['.tag'] === 'file' &&
        imageExtensions.some((ext) =>
          entry.name.toLowerCase().endsWith(ext)
        )
    )

    // If no images found, return debug info
    if (imageFiles.length === 0) {
      return NextResponse.json({
        images: [],
        debug: {
          path: folderPath,
          totalEntries: allEntries.length,
          hasMore: response.result.has_more,
          entries: allEntries.slice(0, 20).map(e => ({
            name: e.name,
            tag: e['.tag'],
            path: 'path_lower' in e ? e.path_lower : undefined
          }))
        }
      })
    }

    const images = await Promise.all(
      imageFiles.slice(0, 50).map(async (file) => {
        try {
          const linkResponse = await dbx.filesGetTemporaryLink({
            path: file.path_lower!,
          })

          const pathParts = file.path_lower!.split('/')
          const project = pathParts.length > 2 ? pathParts[pathParts.length - 2] : 'uncategorized'

          return {
            id: file.id,
            name: file.name,
            url: linkResponse.result.link,
            modified: file.server_modified,
            project,
          }
        } catch {
          return null
        }
      })
    )

    return NextResponse.json({
      images: images.filter(Boolean).sort((a, b) =>
        new Date(b!.modified).getTime() - new Date(a!.modified).getTime()
      ),
    })
  } catch (error: unknown) {
    console.error('Dropbox error:', error)
    const dbxError = error as DropboxError
    const message = dbxError?.error?.error_summary ||
      (error instanceof Error ? error.message : 'Failed to fetch images')
    return NextResponse.json({
      error: message,
      path: folderPath,
    }, { status: 500 })
  }
}
