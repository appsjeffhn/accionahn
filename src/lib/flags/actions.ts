'use server'

import { revalidatePath } from 'next/cache'
import { getSession, requireRole } from '../auth/session'
import { isRollout, setRollout } from './flags'

export async function setRolloutAction(formData: FormData): Promise<void> {
  const session = requireRole(await getSession(), 'agency_admin')
  const next = formData.get('rollout')
  if (!isRollout(next)) throw new Error('Invalid rollout value')
  await setRollout(String(formData.get('key') ?? ''), next, session)
  revalidatePath('/agency/releases')
}
