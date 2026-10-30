import type { ProviderId } from '../types/nova.ts';

export const MAX_MESSAGES_IN_CONTEXT = 60;
export const MAX_MESSAGE_CHARS = 32_000;
export const MAX_BASE64_CHARS_PER_FILE = 8_500_000; // ~6.3 MB binary

export interface ValidatedAttachment {
  name: string;
  mimeType: string;
  kind: 'image' | 'document' | 'text';
  base64Data?: string;
  dataUrl?: string;
  textContent?: string;
}

export interface ValidatedChatMessage {
  role: 'user' | 'assistant';
  content: string;
  attachments?: ValidatedAttachment[];
}

export interface ValidatedChatPayload {
  provider: ProviderId;
  model: string;
  messages: ValidatedChatMessage[];
  realtime: boolean;
}

export function isSecretConfigured(value: string | undefined, placeholder: string): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed === placeholder || trimmed === 'undefined' || trimmed === 'null') {
    return false;
  }
  return true;
}

export function normalizeAndValidateOpenRouterKey(
  raw: unknown
): { ok: true; key: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'Please enter a valid OpenRouter API key.' };
  }

  const stripped = raw.trim().replace(/^Bearer\s+/i, '').trim();
  if (!stripped) {
    return { ok: false, error: 'Please paste your OpenRouter API key.' };
  }

  if (stripped.length < 16 || stripped.length > 256) {
    return {
      ok: false,
      error: 'OpenRouter API key length looks invalid (expected 16–256 characters).',
    };
  }

  if (!/^[!-~]+$/.test(stripped)) {
    return {
      ok: false,
      error: 'API key contains spaces or invalid characters. Paste the exact key string.',
    };
  }

  return { ok: true, key: stripped };
}

export function maskApiKey(key: string): string {
  const clean = key.trim();
  if (!clean) return '';
  if (clean.length <= 12) {
    return `${clean.slice(0, 3)}••••${clean.slice(-2)}`;
  }
  const prefix = clean.startsWith('sk-or-v1-')
    ? 'sk-or-v1-'
    : clean.startsWith('sk-or-')
      ? 'sk-or-'
      : clean.slice(0, 6);
  return `${prefix}••••••••${clean.slice(-4)}`;
}

export function validateChatRequest(
  body: unknown
): { ok: true; data: ValidatedChatPayload } | { ok: false; error: string; status: number } {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Invalid JSON request body.', status: 400 };
  }

  const raw = body as Record<string, unknown>;
  const provider = raw.provider;
  if (provider !== 'gemini' && provider !== 'openrouter') {
    return { ok: false, error: 'Provider must be "gemini" or "openrouter".', status: 400 };
  }

  const model = typeof raw.model === 'string' ? raw.model.trim() : '';
  if (!model || model.length > 160 || !/^[a-zA-Z0-9._:/-]+$/.test(model)) {
    return { ok: false, error: 'A valid model identifier is required.', status: 400 };
  }

  if (!Array.isArray(raw.messages) || raw.messages.length === 0) {
    return { ok: false, error: 'At least one message is required.', status: 400 };
  }

  const recentMessages = raw.messages.slice(-MAX_MESSAGES_IN_CONTEXT);
  const validatedMessages: ValidatedChatMessage[] = [];

  for (const m of recentMessages) {
    if (!m || typeof m !== 'object') {
      return { ok: false, error: 'Malformed message entry.', status: 400 };
    }
    const msg = m as Record<string, unknown>;
    if (msg.role !== 'user' && msg.role !== 'assistant') {
      return { ok: false, error: 'Message role must be "user" or "assistant".', status: 400 };
    }

    const content = typeof msg.content === 'string' ? msg.content : '';
    if (content.length > MAX_MESSAGE_CHARS) {
      return {
        ok: false,
        error: `Message exceeds maximum length of ${MAX_MESSAGE_CHARS.toLocaleString()} characters.`,
        status: 413,
      };
    }

    let validatedAttachments: ValidatedAttachment[] | undefined;
    if (Array.isArray(msg.attachments) && msg.attachments.length > 0) {
      if (msg.attachments.length > 4) {
        return { ok: false, error: 'Maximum 4 attachments allowed per message.', status: 400 };
      }
      validatedAttachments = [];
      for (const a of msg.attachments) {
        if (!a || typeof a !== 'object') continue;
        const att = a as Record<string, unknown>;
        const name = typeof att.name === 'string' ? att.name.slice(0, 200) : 'attachment';
        const mimeType =
          typeof att.mimeType === 'string' ? att.mimeType.slice(0, 120) : 'application/octet-stream';
        const kind =
          att.kind === 'image' || att.kind === 'document' || att.kind === 'text' ? att.kind : 'text';
        const base64Data = typeof att.base64Data === 'string' ? att.base64Data : undefined;
        const dataUrl = typeof att.dataUrl === 'string' ? att.dataUrl : undefined;
        const textContent = typeof att.textContent === 'string' ? att.textContent : undefined;

        if (base64Data && base64Data.length > MAX_BASE64_CHARS_PER_FILE) {
          return { ok: false, error: `Attachment "${name}" exceeds the 6 MB size limit.`, status: 413 };
        }
        if (textContent && textContent.length > 120_000) {
          return {
            ok: false,
            error: `Text attachment "${name}" exceeds 120,000 characters.`,
            status: 413,
          };
        }

        validatedAttachments.push({ name, mimeType, kind, base64Data, dataUrl, textContent });
      }
    }

    if (!content.trim() && (!validatedAttachments || validatedAttachments.length === 0)) {
      continue;
    }

    validatedMessages.push({
      role: msg.role,
      content,
      attachments: validatedAttachments,
    });
  }

  if (validatedMessages.length === 0) {
    return { ok: false, error: 'Prompt cannot be empty.', status: 400 };
  }

  const realtime = raw.realtime !== false;

  return {
    ok: true,
    data: {
      provider,
      model,
      messages: validatedMessages,
      realtime,
    },
  };
}

export class RateLimiter {
  private hits = new Map<string, number[]>();
  private readonly windowMs: number;
  private readonly maxRequests: number;

  constructor(windowMs: number, maxRequests: number) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
  }

  check(key: string, now = Date.now()): { allowed: boolean; retryAfterSec: number } {
    const cutoff = now - this.windowMs;
    const timestamps = (this.hits.get(key) || []).filter((t) => t > cutoff);

    if (timestamps.length >= this.maxRequests) {
      const oldest = timestamps[0];
      const retryAfterSec = Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000));
      this.hits.set(key, timestamps);
      return { allowed: false, retryAfterSec };
    }

    timestamps.push(now);
    this.hits.set(key, timestamps);

    if (this.hits.size > 1000) {
      for (const [k, list] of this.hits.entries()) {
        const filtered = list.filter((t) => t > cutoff);
        if (filtered.length === 0) this.hits.delete(k);
        else this.hits.set(k, filtered);
      }
    }

    return { allowed: true, retryAfterSec: 0 };
  }
}

export function extractCleanErrorMessage(raw: string): string {
  let current = raw.trim();
  const braceIdx = current.indexOf('{');
  if (braceIdx >= 0) {
    for (let depth = 0; depth < 3; depth++) {
      const candidate = depth === 0 ? current.slice(braceIdx) : current;
      try {
        const parsed = JSON.parse(candidate) as {
          message?: unknown;
          error?: { message?: unknown } | string;
        };
        if (typeof parsed.error === 'object' && parsed.error && typeof parsed.error.message === 'string') {
          current = parsed.error.message.trim();
          continue;
        }
        if (typeof parsed.message === 'string') {
          current = parsed.message.trim();
          continue;
        }
        if (typeof parsed.error === 'string') {
          current = parsed.error.trim();
          continue;
        }
        break;
      } catch {
        break;
      }
    }
  }
  return current.replace(/\s+/g, ' ').trim();
}

export function isTransientOverloadError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err || '')).toUpperCase();
  return (
    msg.includes('503') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('HIGH DEMAND') ||
    msg.includes('OVERLOADED') ||
    msg.includes('INTERNAL')
  );
}

export function formatUpstreamProviderError(
  provider: ProviderId,
  err: unknown,
  modelId: string
): {
  status: number;
  code: string;
  message: string;
} {
  const rawMsg = err instanceof Error ? err.message : String(err || 'Unknown provider error');
  const cleanMsg = extractCleanErrorMessage(rawMsg);
  const upper = rawMsg.toUpperCase();

  if (provider === 'gemini') {
    if (upper.includes('API_KEY_INVALID') || upper.includes('API KEY NOT VALID')) {
      return {
        status: 401,
        code: 'GEMINI_INVALID_KEY',
        message:
          'The server GEMINI_API_KEY was rejected. Check your Gemini API key in Google AI Studio under Settings > Secrets.',
      };
    }
    if (upper.includes('PERMISSION_DENIED') || upper.includes('403')) {
      return {
        status: 403,
        code: 'GEMINI_PERMISSION_DENIED',
        message: `Access denied for model "${modelId}". Switch to Gemini 3.1 Flash Lite.`,
      };
    }
    if (upper.includes('RESOURCE_EXHAUSTED') || upper.includes('429') || upper.includes('QUOTA')) {
      return {
        status: 429,
        code: 'GEMINI_QUOTA_EXCEEDED',
        message: `Free-tier rate limit reached for "${modelId}". Wait a few seconds and retry, or switch to Gemini 3.1 Flash Lite.`,
      };
    }
    if (upper.includes('503') || upper.includes('UNAVAILABLE') || upper.includes('HIGH DEMAND')) {
      return {
        status: 503,
        code: 'GEMINI_OVERLOADED',
        message: `"${modelId}" is experiencing temporary high demand. Click Retry or switch to Gemini 3.1 Flash Lite.`,
      };
    }
    if (upper.includes('NOT_FOUND') || upper.includes('404')) {
      return {
        status: 404,
        code: 'GEMINI_MODEL_NOT_FOUND',
        message: `Model "${modelId}" is currently unavailable in this region.`,
      };
    }
    return {
      status: 502,
      code: 'GEMINI_UPSTREAM_ERROR',
      message: `Gemini error: ${cleanMsg.slice(0, 280)}`,
    };
  }

  // OpenRouter errors
  if (
    upper.includes('401') ||
    upper.includes('UNAUTHORIZED') ||
    upper.includes('INVALID CREDENTIALS') ||
    upper.includes('USER NOT FOUND')
  ) {
    return {
      status: 401,
      code: 'OPENROUTER_UNAUTHORIZED',
      message:
        'OpenRouter rejected the API key. Click "Free plan · OpenRouter Key" or open Key Settings to enter a valid key from openrouter.ai/settings/keys.',
    };
  }
  if (upper.includes('402') || upper.includes('INSUFFICIENT') || upper.includes('CREDITS')) {
    return {
      status: 402,
      code: 'OPENROUTER_CREDITS_REQUIRED',
      message: `OpenRouter reported a credit requirement for "${modelId}". Switch to "Free Models Router" (openrouter/free) or another free OpenRouter model.`,
    };
  }
  if (upper.includes('429') || upper.includes('RATE LIMIT')) {
    return {
      status: 429,
      code: 'OPENROUTER_RATE_LIMITED',
      message: `Free-tier rate limit reached on "${modelId}". Try "Free Models Router" (openrouter/free) or another free model.`,
    };
  }
  return {
    status: 502,
    code: 'OPENROUTER_UPSTREAM_ERROR',
    message: `OpenRouter error: ${cleanMsg.slice(0, 280)}`,
  };
}
