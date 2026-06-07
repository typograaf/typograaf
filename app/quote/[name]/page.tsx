import { notFound } from 'next/navigation'
import { getQuoteBySlug, getBlockedDays } from '@/lib/cms'
import QuoteView from './QuoteView'

// Quotes are edited in /admin and stored in R2. Render fresh so an
// edit + Save is visible immediately.
export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params
  const quote = await getQuoteBySlug(name)
  return {
    title: quote ? `${quote.project} — Quote` : 'Quote',
    robots: { index: false, follow: false },
  }
}

export default async function QuotePage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params
  const [quote, blockedDays] = await Promise.all([
    getQuoteBySlug(name),
    getBlockedDays(),
  ])
  if (!quote) notFound()
  return <QuoteView quote={quote} blockedDays={blockedDays} />
}
