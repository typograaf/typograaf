import { readFileSync } from 'fs'
import { put, list } from '@vercel/blob'
import { Dropbox } from 'dropbox'

// Load .env.local
const env = readFileSync('.env.local', 'utf8')
for (const line of env.split('\n')) {
  const match = line.match(/^([^#=]+)=(.*)$/)
  if (match) {
    const key = match[1].trim()
    const val = match[2].trim().replace(/^["']|["']$/g, '')
    process.env[key] = val
  }
}

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.avif']

async function getAccessToken() {
  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: process.env.DROPBOX_REFRESH_TOKEN,
      client_id: process.env.DROPBOX_APP_KEY,
      client_secret: process.env.DROPBOX_APP_SECRET,
    }),
  })
  const data = await res.json()
  if (!data.access_token) throw new Error('Failed to refresh Dropbox token')
  return data.access_token
}

async function getManifest() {
  try {
    const { blobs } = await list({ prefix: 'manifest.json' })
    if (!blobs.length) return []
    const res = await fetch(blobs[0].url)
    return res.json()
  } catch {
    return []
  }
}

async function saveManifest(images) {
  await put('manifest.json', JSON.stringify(images), {
    access: 'public',
    allowOverwrite: true,
    contentType: 'application/json',
  })
}

async function main() {
  console.log('Fetching Dropbox file list...')
  const folderPath = process.env.DROPBOX_FOLDER_PATH || ''
  const accessToken = await getAccessToken()
  const dbx = new Dropbox({ accessToken, fetch })

  let allEntries = []
  let response = await dbx.filesListFolder({ path: folderPath, recursive: true })
  allEntries = allEntries.concat(response.result.entries)
  while (response.result.has_more) {
    response = await dbx.filesListFolderContinue({ cursor: response.result.cursor })
    allEntries = allEntries.concat(response.result.entries)
  }

  const imageFiles = allEntries.filter(
    e => e['.tag'] === 'file' && IMAGE_EXTENSIONS.some(ext => e.name.toLowerCase().endsWith(ext))
  ).map(e => ({ id: e.id, name: e.name, path: e.path_lower }))

  console.log(`Found ${imageFiles.length} images in Dropbox`)

  const manifest = await getManifest()
  const manifestById = new Map(manifest.map(img => [img.id, img]))

  const toAdd = imageFiles.filter(f => !manifestById.has(f.id))
  console.log(`${toAdd.length} new images to upload (${manifest.length} already in Blob)`)

  let added = 0
  for (const file of toAdd) {
    try {
      const linkRes = await dbx.filesGetTemporaryLink({ path: file.path })
      const tempUrl = linkRes.result.link
      const imageRes = await fetch(tempUrl)
      const imageBuffer = await imageRes.arrayBuffer()
      const ext = file.name.split('.').pop() || 'jpg'
      const blob = await put(`images/${file.id}.${ext}`, imageBuffer, {
        access: 'public',
        allowOverwrite: true,
        contentType: imageRes.headers.get('content-type') || 'image/jpeg',
      })
      manifest.push({ id: file.id, name: file.name, path: file.path, blobUrl: blob.url })
      added++
      process.stdout.write(`\r  Uploaded ${added}/${toAdd.length}: ${file.name}                    `)
    } catch (err) {
      console.error(`\n  Failed: ${file.name} — ${err.message}`)
    }
  }

  console.log('\nSaving manifest...')
  await saveManifest(manifest)
  console.log(`Done! ${added} images uploaded, ${manifest.length} total in Blob.`)
}

main().catch(err => { console.error(err); process.exit(1) })
