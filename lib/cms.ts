import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import bundledProjectOrder from '../project-order.json'

const BUCKET = 'typograaf'
const PUBLIC_URL = process.env.R2_PUBLIC_URL || ''
const ORDER_KEY = 'cms/project-order.json'
const ABOUT_KEY = 'cms/about.json'

function getS3() {
  return new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT!,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  })
}

export async function getProjectOrderOverride(): Promise<string[] | null> {
  try {
    const res = await fetch(`${PUBLIC_URL}/${ORDER_KEY}`, { cache: 'no-store' })
    if (!res.ok) return null
    const data = await res.json()
    return Array.isArray(data) ? data.filter((p): p is string => typeof p === 'string') : null
  } catch {
    return null
  }
}

export async function saveProjectOrderOverride(order: string[]): Promise<void> {
  const client = getS3()
  await client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: ORDER_KEY,
    Body: JSON.stringify(order),
    ContentType: 'application/json',
  }))
}

const DEFAULT_ABOUT = `Martijn Mertens (1999) is an all-round graphic designer based in Antwerp. He specialises in typography and brand design.
Additionally, Martijn teaches part-time at Sint Lucas Antwerp, focusing on a systems-based approach to branding.
SELECTED CLIENTS
Stad Brugge, KRC Genk, RAFC Antwerp, RSCA, Brussels Airlines, Mas Antwerpen, Caroline Bosmans, Prado
SELECTED AGENCIES
Mutant™, WeWantMore, Base Design, Today, AKQA, Lobster, Mr. Henry, Off The Grid, Lucy
SERVICES
Typography, Branding, Motion Design, 3D, UX/UI, Creative Coding`

export async function getAboutText(): Promise<string> {
  try {
    const res = await fetch(`${PUBLIC_URL}/${ABOUT_KEY}`, { cache: 'no-store' })
    if (!res.ok) return DEFAULT_ABOUT
    const data = await res.json()
    return typeof data?.text === 'string' ? data.text : DEFAULT_ABOUT
  } catch {
    return DEFAULT_ABOUT
  }
}

export async function saveAboutText(text: string): Promise<void> {
  const client = getS3()
  await client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: ABOUT_KEY,
    Body: JSON.stringify({ text }),
    ContentType: 'application/json',
  }))
}

export { bundledProjectOrder as DEFAULT_PROJECT_ORDER }
