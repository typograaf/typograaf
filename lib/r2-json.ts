import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'

const BUCKET = 'typograaf'

export type R2JsonRead = { ok: true; data: unknown | null } | { ok: false }

// Reads a JSON object straight from the bucket over the S3 API: strongly
// consistent and not subject to the public r2.dev URL's edge cache or rate
// limit. `data: null` means the key does not exist. `ok: false` means we
// could not find out — code that goes on to mutate state from the answer
// must treat that as "unknown", never as "empty".
export async function r2GetJson(key: string): Promise<R2JsonRead> {
  try {
    const client = new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT!,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    })
    const res = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
    const text = await res.Body?.transformToString()
    if (!text) return { ok: false }
    return { ok: true, data: JSON.parse(text) }
  } catch (err) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } }
    if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) return { ok: true, data: null }
    return { ok: false }
  }
}
