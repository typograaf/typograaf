import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import bundledProjectOrder from '../project-order.json'
import { type Quote, normalizeQuote } from './quote'

const BUCKET = 'typograaf'
const PUBLIC_URL = process.env.R2_PUBLIC_URL || ''
const ORDER_KEY = 'cms/project-order.json'
const ABOUT_KEY = 'cms/about.json'
const HIDDEN_KEY = 'cms/hidden-images.json'
const QUOTES_KEY = 'cms/quotes.json'
const SENTENCES_KEY = 'cms/sentences.json'
const AXES_KEY = 'cms/preview-axes.json'

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

export async function getHiddenImageIds(): Promise<string[]> {
  try {
    const res = await fetch(`${PUBLIC_URL}/${HIDDEN_KEY}`, { cache: 'no-store' })
    if (!res.ok) return []
    const data = await res.json()
    return Array.isArray(data) ? data.filter((p): p is string => typeof p === 'string') : []
  } catch {
    return []
  }
}

export async function saveHiddenImageIds(ids: string[]): Promise<void> {
  const client = getS3()
  const unique = Array.from(new Set(ids))
  await client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: HIDDEN_KEY,
    Body: JSON.stringify(unique),
    ContentType: 'application/json',
  }))
}

export async function getQuotes(): Promise<Quote[]> {
  try {
    // Cache-buster: R2's public URL is edge-cached, so a freshly saved
    // quote wouldn't appear without defeating that cache.
    const res = await fetch(`${PUBLIC_URL}/${QUOTES_KEY}?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return []
    const data = await res.json()
    if (!Array.isArray(data)) return []
    return data
      .map(normalizeQuote)
      .filter((q): q is Quote => q !== null)
  } catch {
    return []
  }
}

export async function getQuoteBySlug(slug: string): Promise<Quote | null> {
  const quotes = await getQuotes()
  return quotes.find((q) => q.slug === slug) || null
}

export async function saveQuotes(quotes: Quote[]): Promise<void> {
  const cleaned = quotes
    .map(normalizeQuote)
    .filter((q): q is Quote => q !== null)
  // Last write wins on duplicate slugs.
  const bySlug = new Map<string, Quote>()
  for (const q of cleaned) bySlug.set(q.slug, q)
  const client = getS3()
  await client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: QUOTES_KEY,
    Body: JSON.stringify(Array.from(bySlug.values())),
    ContentType: 'application/json',
  }))
}

// Sample sentences shown in the typeface type-tester. Editable via the
// admin Sentences tab; this list is the seed used until something is saved.
const DEFAULT_SENTENCES = [
  'Ideas are like fish',
  'Life is very very complicated',
  'Read read read read read',
  'I think in pictures',
  'The work is mysterious and important',
  'Please enjoy each fact equally',
  'Bing bop boom boom boom bop bam',
  'Sometimes I get emotional over fonts',
  'Yesyesyesyes',
  'I don’t give a flying FUCK about Fonts',
  'I don’t remember it being this far',
  'Better never than late',
  'The reward for good work is more work',
  'The darkest cowboy in town',
  'Almost good enough',
  'Don’t talk about my moms yo',
  'Meet you at the AFAS Dome',
  'Winter miles summer smiles',
  'The spice must flow',
  'I FEEL KINDA FREEEE',
  'They don’t understand the things I say on Twitter',
  'I’m the sausage man',
  'when you’re a ant and you wake up in an awesome mood about to drive your son to school only to discover that you left the lights on in the car last night so your battery is drained',
  'What’s your day rate',
  'Run',
  'Try linkedIn Premium for free',
  'Was this answer helpful',
  'Teamleader is the enemy',
  'AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz',
  'I won’t read your strategy',
  'Pay me Bolo',
  'TIME TO BOIL THE OCEAN',
  'IDK I’m no dentist',
  'Crop of the century',
  'Always be Committing',
  'One right here one right here',
  'Er zijn ook geen dino’s meer en die waren super sterk',
  'Gas chamber for the blue raspberry chicken',
  'What if I do a freelance piece in your bedroom',
  'Belastingsaangifte',
  'Extremely profitable',
  'J’ai perdu le contrôle',
  'Slow motion sunscreen application',
  'French mechanics',
  'Plets plets plets',
  'I had potential',
  'The ceiling has asbestos!',
  'Words of encouragement',
  'Cocodrillo Turbo',
  'High risk no reward',
]

export async function getSentences(): Promise<string[]> {
  try {
    const res = await fetch(`${PUBLIC_URL}/${SENTENCES_KEY}?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return DEFAULT_SENTENCES
    const data = await res.json()
    if (!Array.isArray(data)) return DEFAULT_SENTENCES
    const cleaned = data.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    return cleaned.length > 0 ? cleaned : DEFAULT_SENTENCES
  } catch {
    return DEFAULT_SENTENCES
  }
}

export async function saveSentences(sentences: string[]): Promise<void> {
  const cleaned = sentences
    .filter((s): s is string => typeof s === 'string')
    .map(s => s.trim())
    .filter(Boolean)
  const client = getS3()
  await client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: SENTENCES_KEY,
    Body: JSON.stringify(cleaned),
    ContentType: 'application/json',
  }))
}

type AxisMap = Record<string, Record<string, number>>

// Per-typeface default variable-axis values (e.g. { wght, wdth }), keyed by
// font tile id (font:<folder>).
export async function getPreviewAxes(): Promise<AxisMap> {
  try {
    const res = await fetch(`${PUBLIC_URL}/${AXES_KEY}?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return {}
    const data = await res.json()
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
    const out: AxisMap = {}
    for (const [id, axes] of Object.entries(data)) {
      if (!axes || typeof axes !== 'object' || Array.isArray(axes)) continue
      const clean: Record<string, number> = {}
      for (const [tag, v] of Object.entries(axes as Record<string, unknown>)) {
        if (typeof v === 'number' && Number.isFinite(v)) clean[tag] = v
      }
      if (Object.keys(clean).length) out[id] = clean
    }
    return out
  } catch {
    return {}
  }
}

export async function savePreviewAxes(axesById: AxisMap): Promise<void> {
  const clean: AxisMap = {}
  for (const [id, axes] of Object.entries(axesById || {})) {
    if (!axes || typeof axes !== 'object') continue
    const a: Record<string, number> = {}
    for (const [tag, v] of Object.entries(axes)) {
      const n = Number(v)
      if (Number.isFinite(n)) a[tag] = Math.round(n * 100) / 100
    }
    if (Object.keys(a).length) clean[id] = a
  }
  const client = getS3()
  await client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: AXES_KEY,
    Body: JSON.stringify(clean),
    ContentType: 'application/json',
  }))
}

export { bundledProjectOrder as DEFAULT_PROJECT_ORDER, DEFAULT_SENTENCES }
