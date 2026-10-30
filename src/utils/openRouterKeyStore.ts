import type { OpenRouterKeyStorageMode } from '../types/nova.ts';
import { normalizeAndValidateOpenRouterKey } from './apiValidation.ts';

const LOCAL_KEY_NAME = 'nova_ai_openrouter_key_v1';
const SESSION_KEY_NAME = 'nova_ai_openrouter_key_session_v1';

export interface StoredOpenRouterKey {
  key: string;
  storageMode: OpenRouterKeyStorageMode;
}

export function loadUserOpenRouterKey(): StoredOpenRouterKey | null {
  try {
    const sessionVal = window.sessionStorage.getItem(SESSION_KEY_NAME);
    if (sessionVal) {
      const checked = normalizeAndValidateOpenRouterKey(sessionVal);
      if (checked.ok) {
        return { key: checked.key, storageMode: 'session' };
      }
    }
  } catch {
    // Ignore storage error
  }

  try {
    const localVal = window.localStorage.getItem(LOCAL_KEY_NAME);
    if (localVal) {
      const checked = normalizeAndValidateOpenRouterKey(localVal);
      if (checked.ok) {
        return { key: checked.key, storageMode: 'local' };
      }
    }
  } catch {
    // Ignore storage error
  }

  return null;
}

export function saveUserOpenRouterKey(
  rawKey: string,
  storageMode: OpenRouterKeyStorageMode
): { ok: true; key: string } | { ok: false; error: string } {
  const checked = normalizeAndValidateOpenRouterKey(rawKey);
  if (!checked.ok) {
    return checked;
  }

  try {
    if (storageMode === 'session') {
      window.sessionStorage.setItem(SESSION_KEY_NAME, checked.key);
      window.localStorage.removeItem(LOCAL_KEY_NAME);
    } else {
      window.localStorage.setItem(LOCAL_KEY_NAME, checked.key);
      window.sessionStorage.removeItem(SESSION_KEY_NAME);
    }
  } catch {
    // Ignore storage quota / privacy mode error; caller still holds state in memory
  }

  return { ok: true, key: checked.key };
}

export function clearUserOpenRouterKey(): void {
  try {
    window.localStorage.removeItem(LOCAL_KEY_NAME);
  } catch {
    // Ignore
  }
  try {
    window.sessionStorage.removeItem(SESSION_KEY_NAME);
  } catch {
    // Ignore
  }
}
