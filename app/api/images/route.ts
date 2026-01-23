import { Dropbox } from 'dropbox'
import { NextResponse } from 'next/server'

export const revalidate = 60 // Revalidate every 60 seconds

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

    const response = await dbx.filesListFolder({ path: folderPath })

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

        const linkResponse = await dbx.filesGetTemporaryLink({
          path: file.path_lower!,
        })

        return {
          id: file.id,
          name: file.name,
          url: linkResponse.result.link,
          modified: file.server_modified,
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
    const message = error instanceof Error ? error.message : 'Failed to fetch images'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
