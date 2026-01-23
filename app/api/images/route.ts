import { Dropbox, files } from 'dropbox'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

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

    const images = await Promise.all(
      imageFiles.map(async (file) => {
        try {
          const linkResponse = await dbx.filesGetTemporaryLink({ path: file.path_lower! })
          return {
            id: file.id,
            name: file.name,
            url: linkResponse.result.link,
            modified: file.server_modified,
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
    const message = error instanceof Error ? error.message : 'Failed to fetch images'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
