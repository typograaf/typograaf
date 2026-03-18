import { Dropbox, files } from 'dropbox'

export interface DropboxFile {
  id: string
  name: string
  path: string
}

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.avif']

export async function getAccessToken(): Promise<string> {
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

export async function getDropboxImageFiles(): Promise<DropboxFile[]> {
  const folderPath = process.env.DROPBOX_FOLDER_PATH || ''
  const accessToken = await getAccessToken()
  const dbx = new Dropbox({ accessToken, fetch })

  let allEntries: files.MetadataReference[] = []
  let response = await dbx.filesListFolder({ path: folderPath, recursive: true })
  allEntries = allEntries.concat(response.result.entries)

  while (response.result.has_more) {
    response = await dbx.filesListFolderContinue({ cursor: response.result.cursor })
    allEntries = allEntries.concat(response.result.entries)
  }

  return allEntries
    .filter(
      (entry): entry is files.FileMetadataReference =>
        entry['.tag'] === 'file' &&
        IMAGE_EXTENSIONS.some(ext => entry.name.toLowerCase().endsWith(ext))
    )
    .map(entry => ({ id: entry.id, name: entry.name, path: entry.path_lower! }))
}

export async function getDropboxTempLink(path: string): Promise<string> {
  const accessToken = await getAccessToken()
  const dbx = new Dropbox({ accessToken, fetch })
  const res = await dbx.filesGetTemporaryLink({ path })
  return res.result.link
}
