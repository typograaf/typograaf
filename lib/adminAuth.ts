import { cookies } from 'next/headers'

export async function isAuthed(): Promise<boolean> {
  const c = await cookies()
  return c.get('auth')?.value === '1'
}
