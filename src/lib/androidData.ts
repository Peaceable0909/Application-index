import { admin } from './supabase';
import { ANDROID_SETTING, readSettings, type AndroidSettings } from './androidApp';

/** The Android settings an admin saved (Settings, Android app) plus any fingerprints in the ANDROID_CERT_SHA256 environment variable. Never throws: the file must always answer. */
export async function loadAndroid(): Promise<AndroidSettings> {
  try {
    const { data } = await admin().from('portal_settings').select('value').eq('key', ANDROID_SETTING).maybeSingle();
    return readSettings(data?.value, process.env.ANDROID_CERT_SHA256);
  } catch {
    return readSettings(null, process.env.ANDROID_CERT_SHA256);
  }
}
