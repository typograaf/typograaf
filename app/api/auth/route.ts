import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const { password } = await request.json()
  const correct = password === process.env.SITE_PASSWORD

  const response = NextResponse.json({ success: correct })

  if (correct) {
    response.cookies.set('auth', '1', {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
    })
  }

  return response
}
