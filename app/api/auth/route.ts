import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const { password } = await request.json()
  const correct = password === process.env.SITE_PASSWORD

  return NextResponse.json({ success: correct })
}
