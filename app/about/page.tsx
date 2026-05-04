import { getAboutText } from '../../lib/cms'

export const dynamic = 'force-dynamic'

export default async function About() {
  const text = await getAboutText()
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  return (
    <main className="about-page">
      {lines.map((line, i) => <p key={i}>{line}</p>)}
    </main>
  )
}
