import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import {
  getAboutText,
  saveAboutText,
  saveProjectOrderOverride,
} from '../../../lib/cms'
import { getProjectOrder } from '../../../lib/sync'

export const dynamic = 'force-dynamic'

async function isAuthed() {
  const c = await cookies()
  return c.get('auth')?.value === '1'
}

export async function GET() {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const [order, about] = await Promise.all([getProjectOrder(), getAboutText()])
  return NextResponse.json({ order, about })
}

export async function POST(request: NextRequest) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const body = await request.json().catch(() => ({}))

  if (Array.isArray(body.order)) {
    const cleaned = body.order
      .filter((p: unknown): p is string => typeof p === 'string')
      .map((p: string) => p.trim())
      .filter(Boolean)
    await saveProjectOrderOverride(cleaned)
  }
  if (typeof body.about === 'string') {
    await saveAboutText(body.about)
  }

  revalidatePath('/about')
  revalidatePath('/')
  revalidatePath('/work')

  return NextResponse.json({ ok: true })
}
