import { Dropbox } from 'dropbox'
import { NextResponse } from 'next/server'

export const revalidate = 60

interface DropboxError {
  error?: {
    error_summary?: string
    [key: string]: unknown
  }
}

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

    // Use recursive listing to get all files in subfolders
    const response = await dbx.filesListFolder({
      path: folderPath,
      recursive: true
    })

    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']
    const imageFiles = response.result.entries.filter(
      (entry) =>
        entry['.tag'] === 'file' &&
        imageExtensions.some((ext) =>
          entry.name.toLowerCase().endsWith(ext)
        )
    )

    const images = await Promise.all(
      imageFiles.map(async (file) => {
        if (file['.tag'] !== 'file') return null

        try {
          const linkResponse = await dbx.filesGetTemporaryLink({
            path: file.path_lower!,
          })

          // Extract project name from path
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
