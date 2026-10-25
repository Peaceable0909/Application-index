// Which profile fields an admin locked (portal_settings key "profile_edit"). Kept in its own small file so the profile actions can ask without loading the assignment code.
import { cache } from 'react';
import { admin } from './supabase';
import { parseLocks, type LockKey } from './profileRules';

export const LOCKS_SETTING = 'profile_edit';

export const profileLocks = cache(async (): Promise<LockKey[]> => {
  const { data } = await admin().from('portal_settings').select('value').eq('key', LOCKS_SETTING).maybeSingle();
  return parseLocks(data?.value);
});
