import 'dotenv/config';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import {
  GoogleGenAI,
  Modality,
  type Content,
  type LiveServerMessage,
  type Part,
} from '@google/genai';
import { WebSocket, WebSocketServer } from 'ws';
import type { ModelInfo } from './src/types/nova.ts';
import {
  GEMINI_CHAT_MODELS,
  isAllowedFreeGeminiChatModel,
  isExcludedOpenRouterModel,
  normalizeOpenRouterModels,
} from './src/utils/modelCapabilities.ts';
import { normalizeLiveVoice } from './src/utils/liveAudio.ts';
import {
  RateLimiter,
  formatUpstreamProviderError,
  isSecretConfigured,
  isTransientOverloadError,
  normalizeAndValidateOpenRouterKey,
  validateChatRequest,
  type ValidatedChatMessage,
} from './src/utils/apiValidation.ts';
import {
  fetchLivePulseSnapshot,
  gatherRealtimeContext,
} from './src/utils/realtimeData.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

const chatLimiter = new RateLimiter(60_000, 40);
const verifyLimiter = new RateLimiter(60_000, 20);
const liveLimiter = new RateLimiter(60_000, 30);

interface CachedOpenRouterCatalog {
  chatModels: ModelInfo[];
  fetchedAt: number;
  error?: string;
}

let openRouterCache: CachedOpenRouterCatalog | null = null;
const OPENROUTER_CACHE_TTL_MS = 5 * 60 * 1000;

function getClientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'local';
}

let serverOpenRouterKeyVerified: boolean | null = null;
let serverOpenRouterKeyCheckPromise: Promise<boolean> | null = null;

async function verifyServerOpenRouterEnvKey(): Promise<boolean> {
  if (!isSecretConfigured(process.env.OPENROUTER_API_KEY, 'MY_OPENROUTER_API_KEY')) {
    serverOpenRouterKeyVerified = false;
    return false;
  }
  const candidate = process.env.OPENROUTER_API_KEY!.trim();
  if (!candidate.startsWith('sk-or-')) {
    serverOpenRouterKeyVerified = false;
    return false;
  }
  if (serverOpenRouterKeyVerified !== null) {
    return serverOpenRouterKeyVerified;
  }
  if (serverOpenRouterKeyCheckPromise) {
    return serverOpenRouterKeyCheckPromise;
  }

  serverOpenRouterKeyCheckPromise = (async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5_000);
      const resp = await fetch('https://openrouter.ai/api/v1/auth/key', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${candidate}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
      clearTimeout(timer);
      const valid = resp.status !== 401 && resp.status !== 403;
      serverOpenRouterKeyVerified = valid;
      return valid;
    } catch {
      serverOpenRouterKeyVerified = true;
      return true;
    } finally {
      serverOpenRouterKeyCheckPromise = null;
    }
  })();

  return serverOpenRouterKeyCheckPromise;
}

function isServerOpenRouterKeyUsable(): boolean {
  if (!isSecretConfigured(process.env.OPENROUTER_API_KEY, 'MY_OPENROUTER_API_KEY')) {
    return false;
  }
  const candidate = process.env.OPENROUTER_API_KEY!.trim();
  if (!candidate.startsWith('sk-or-')) {
    return false;
  }
  return serverOpenRouterKeyVerified !== false;
}

function resolveOpenRouterKey(
  req: Request
): { ok: true; key: string | null; hasHeaderKey: boolean } | { ok: false; error: string } {
  const headerRaw = req.headers['x-openrouter-key'];
  if (typeof headerRaw === 'string' && headerRaw.trim()) {
    const validated = normalizeAndValidateOpenRouterKey(headerRaw);
    if (!validated.ok) {
      return { ok: false, error: validated.error };
    }
    return { ok: true, key: validated.key, hasHeaderKey: true };
  }

  if (isServerOpenRouterKeyUsable()) {
    return { ok: true, key: process.env.OPENROUTER_API_KEY!.trim(), hasHeaderKey: false };
  }

  return { ok: true, key: null, hasHeaderKey: false };
}

function getProviderStatus(req?: Request) {
  const geminiConfigured = isSecretConfigured(process.env.GEMINI_API_KEY, 'MY_GEMINI_API_KEY');
  const openRouterServerConfigured = isServerOpenRouterKeyUsable();
  const resolved = req ? resolveOpenRouterKey(req) : null;
  const hasValidClientKey = Boolean(resolved && resolved.ok && resolved.key);

  return {
    geminiConfigured,
    openRouterServerConfigured,
    openRouterConfigured: openRouterServerConfigured || hasValidClientKey,
  };
}

function createGeminiClient(): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function fetchOpenRouterCatalog(
  forceRefresh = false,
  optionalKey?: string | null
): Promise<CachedOpenRouterCatalog> {
  const now = Date.now();
  if (!forceRefresh && openRouterCache && now - openRouterCache.fetchedAt < OPENROUTER_CACHE_TTL_MS) {
    return openRouterCache;
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'HTTP-Referer': process.env.APP_URL || 'http://localhost:3000',
    'X-Title': 'Nova AI',
  };

  const authKey =
    optionalKey ||
    (isServerOpenRouterKeyUsable()
      ? process.env.OPENROUTER_API_KEY!.trim()
      : null);

  if (authKey) {
    headers.Authorization = `Bearer ${authKey}`;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const resp = await fetch('https://openrouter.ai/api/v1/models', {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) {
      throw new Error(`OpenRouter model catalog returned HTTP ${resp.status}.`);
    }

    const json = (await resp.json()) as { data?: unknown };
    const normalized = normalizeOpenRouterModels(json.data, { freeOnly: true });

    openRouterCache = {
      chatModels: normalized.chatModels,
      fetchedAt: now,
    };
    return openRouterCache;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unable to reach OpenRouter model catalog.';
    if (openRouterCache && openRouterCache.chatModels.length > 0) {
      return { ...openRouterCache, error: errMsg };
    }
    return {
      chatModels: [],
      fetchedAt: now,
      error: errMsg,
    };
  }
}

function isAllowedFreeOpenRouterModel(modelId: string): boolean {
  if (isExcludedOpenRouterModel(modelId)) {
    return false;
  }
  if (modelId === 'openrouter/free' || modelId.endsWith(':free')) {
    return true;
  }
  if (openRouterCache) {
    return openRouterCache.chatModels.some((m) => m.id === modelId && m.isFree);
  }
  return false;
}

function buildGeminiContents(messages: ValidatedChatMessage[]): Content[] {
  return messages.map((msg) => {
    const parts: Part[] = [];

    if (msg.attachments && msg.attachments.length > 0) {
      for (const att of msg.attachments) {
        if (att.kind === 'document' && att.base64Data) {
          parts.push({
            inlineData: {
              mimeType: att.mimeType,
              data: att.base64Data,
            },
          });
        } else if (att.textContent) {
          parts.push({
            text: `[Attached file: ${att.name}]\n\`\`\`\n${att.textContent}\n\`\`\``,
          });
        }
      }
    }

    if (msg.content.trim() || parts.length === 0) {
      parts.push({ text: msg.content || 'Please analyze the attached file.' });
    }

    return {
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts,
    };
  });
}

function buildOpenRouterMessages(
  messages: ValidatedChatMessage[],
  realtimeContextBlock?: string
) {
  const baseSystem =
    'You are Nova AI, a calm, articulate, and deeply accurate assistant. Format responses cleanly in Markdown and include language identifiers on fenced code blocks.';
  const systemMessage = {
    role: 'system',
    content: realtimeContextBlock ? `${baseSystem}\n\n${realtimeContextBlock}` : baseSystem,
  };

  const mapped = messages.map((msg) => {
    if (!msg.attachments || msg.attachments.length === 0) {
      return {
        role: msg.role,
        content: msg.content,
      };
    }

    const contentParts: Array<Record<string, unknown>> = [];
    let combinedText = msg.content;

    for (const att of msg.attachments) {
      if (att.kind === 'document' && att.dataUrl) {
        contentParts.push({
          type: 'file',
          file: {
            filename: att.name,
            file_data: att.dataUrl,
          },
        });
      } else if (att.textContent) {
        combinedText = `[Attached file: ${att.name}]\n\`\`\`\n${att.textContent}\n\`\`\`\n\n${combinedText}`;
      }
    }

    if (contentParts.length === 0) {
      return {
        role: msg.role,
        content: combinedText || 'Please analyze the attached file.',
      };
    }

    if (combinedText.trim()) {
      contentParts.unshift({
        type: 'text',
        text: combinedText,
      });
    }

    return {
      role: msg.role,
      content: contentParts,
    };
  });

  return [systemMessage, ...mapped];
}

function sendSseEvent(res: Response, payload: Record<string, unknown>) {
  if (!res.writableEnded) {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }
}

async function startServer() {
  const app = express();

  app.disable('x-powered-by');
  app.use((_, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  app.use(express.json({ limit: '16mb' }));

  app.use((err: Error & { status?: number; type?: string }, _req: Request, res: Response, next: NextFunction) => {
    if (err?.type === 'entity.too.large' || err?.status === 413) {
      res.status(413).json({
        error: 'Request payload is too large. Please keep attachments under 6 MB each (12 MB total).',
        code: 'PAYLOAD_TOO_LARGE',
      });
      return;
    }
    if (err instanceof SyntaxError) {
      res.status(400).json({ error: 'Invalid JSON request payload.', code: 'BAD_JSON' });
      return;
    }
    next(err);
  });

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, status: getProviderStatus(req) });
  });

  app.get('/api/providers/status', (req, res) => {
    res.json(getProviderStatus(req));
  });

  app.post('/api/openrouter/verify', async (req, res) => {
    const ip = getClientIp(req);
    const rate = verifyLimiter.check(ip);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSec));
      res.status(429).json({
        valid: false,
        error: `Too many verification attempts. Please wait ${rate.retryAfterSec}s.`,
      });
      return;
    }

    const rawCandidate =
      typeof req.headers['x-openrouter-key'] === 'string' && req.headers['x-openrouter-key'].trim()
        ? req.headers['x-openrouter-key']
        : (req.body as { apiKey?: unknown } | undefined)?.apiKey;

    const checked = normalizeAndValidateOpenRouterKey(rawCandidate);
    if (!checked.ok) {
      res.status(400).json({ valid: false, error: checked.error });
      return;
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8_000);
      const upstream = await fetch('https://openrouter.ai/api/v1/auth/key', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${checked.key}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (upstream.status === 401 || upstream.status === 403) {
        res.status(401).json({
          valid: false,
          error:
            'OpenRouter rejected this API key. Copy an active key from openrouter.ai/settings/keys and try again.',
        });
        return;
      }

      if (!upstream.ok) {
        res.json({
          valid: true,
          warning: `Key saved — OpenRouter key check returned HTTP ${upstream.status}, ready to test in chat.`,
        });
        return;
      }

      const payload = (await upstream.json()) as {
        data?: { label?: string; is_free_tier?: boolean };
      };

      res.json({
        valid: true,
        label: payload.data?.label || undefined,
        isFreeTier: payload.data?.is_free_tier,
      });
    } catch {
      res.json({
        valid: true,
        warning: 'Key format verified and saved — live check timed out, ready to use in chat.',
      });
    }
  });

  app.get('/api/models', async (req, res) => {
    await verifyServerOpenRouterEnvKey();
    const forceRefresh = req.query.refresh === '1';
    const resolvedKey = resolveOpenRouterKey(req);
    const optionalKey = resolvedKey.ok ? resolvedKey.key : null;
    const orCatalog = await fetchOpenRouterCatalog(forceRefresh, optionalKey);
    const status = getProviderStatus(req);

    res.json({
      gemini: GEMINI_CHAT_MODELS,
      openrouter: orCatalog.chatModels,
      openRouterError: orCatalog.error,
      status,
    });
  });

  app.get('/api/realtime/pulse', async (req, res) => {
    try {
      const force = req.query.refresh === '1';
      const pulse = await fetchLivePulseSnapshot(force);
      res.json(pulse);
    } catch {
      res.json({
        updatedAtIso: new Date().toISOString(),
        headlines: [],
      });
    }
  });

  app.post('/api/chat/stream', async (req, res) => {
    const ip = getClientIp(req);
    const rate = chatLimiter.check(ip);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSec));
      res.status(429).json({
        error: `Rate limit reached. Please wait ${rate.retryAfterSec}s before sending another message.`,
        code: 'RATE_LIMITED',
      });
      return;
    }

    const validation = validateChatRequest(req.body);
    if (!validation.ok) {
      res.status(validation.status).json({
        error: validation.error,
        code: 'VALIDATION_ERROR',
      });
      return;
    }

    const { provider, model, messages, realtime } = validation.data;
    const latestMessage = messages[messages.length - 1];
    if (latestMessage?.attachments?.some((att) => att.kind === 'image')) {
      res.status(400).json({
        error: 'Vision and image uploads are disabled. Please attach text, code, or PDF files instead.',
        code: 'VISION_DISABLED',
      });
      return;
    }

    const status = getProviderStatus(req);

    if (provider === 'gemini') {
      if (!isAllowedFreeGeminiChatModel(model)) {
        res.status(400).json({
          error: 'Selected Gemini model is unavailable. Please select Gemini 3.1 Flash Lite.',
          code: 'MODEL_UNAVAILABLE',
        });
        return;
      }

      if (!status.geminiConfigured) {
        res.status(401).json({
          error:
            'GEMINI_API_KEY is not configured on the server. Add GEMINI_API_KEY in Google AI Studio under Settings > Secrets.',
          code: 'MISSING_GEMINI_KEY',
        });
        return;
      }
    }

    let openRouterKey: string | null = null;
    if (provider === 'openrouter') {
      if (isExcludedOpenRouterModel(model)) {
        res.status(400).json({
          error: 'Selected OpenRouter model has been removed. Please choose another free model.',
          code: 'MODEL_UNAVAILABLE',
        });
        return;
      }

      if (!isAllowedFreeOpenRouterModel(model)) {
        res.status(400).json({
          error: 'Paid OpenRouter models are disabled. Please select one of the free OpenRouter models.',
          code: 'PAID_MODEL_DISABLED',
        });
        return;
      }

      const resolved = resolveOpenRouterKey(req);
      if (!resolved.ok) {
        res.status(400).json({
          error: resolved.error,
          code: 'INVALID_OPENROUTER_KEY',
        });
        return;
      }

      if (!resolved.key) {
        res.status(401).json({
          error:
            'Connect your free OpenRouter API key inside Nova AI to chat with free OpenRouter models, or switch to Gemini 3.1 Flash Lite.',
          code: 'MISSING_OPENROUTER_KEY',
        });
        return;
      }
      openRouterKey = resolved.key;
    }

    let clientAborted = false;
    const abortController = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) {
        clientAborted = true;
        abortController.abort();
      }
    });

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    let realtimeContextBlock: string | undefined;
    if (realtime && latestMessage?.content?.trim()) {
      sendSseEvent(res, {
        type: 'status',
        text: 'Gathering live real-time data…',
      });
      try {
        const rt = await gatherRealtimeContext(latestMessage.content);
        if (!clientAborted) {
          realtimeContextBlock = rt.contextBlock;
          if (rt.sources.length > 0) {
            sendSseEvent(res, {
              type: 'sources',
              sources: rt.sources,
            });
          }
          sendSseEvent(res, {
            type: 'status',
            text:
              provider === 'openrouter'
                ? 'Synthesizing live data with OpenRouter…'
                : 'Synthesizing live response…',
          });
        }
      } catch {
        // Proceed cleanly without live context if upstream feeds time out
      }
    }

    if (clientAborted) {
      if (!res.writableEnded) res.end();
      return;
    }

    if (provider === 'gemini') {
      const ai = createGeminiClient();
      const contents = buildGeminiContents(messages);
      const baseInstruction =
        'You are Nova AI, a calm, articulate, and deeply knowledgeable assistant. Format responses cleanly with Markdown and include language identifiers on fenced code blocks.';
      const systemInstruction = realtimeContextBlock
        ? `${baseInstruction}\n\n${realtimeContextBlock}`
        : baseInstruction;

      const candidateModels = ['gemini-3.1-flash-lite', 'gemini-3.1-flash-lite'];

      let lastErr: unknown = null;
      let streamedAnyText = false;

      try {
        for (let attempt = 0; attempt < candidateModels.length; attempt++) {
          if (clientAborted) break;
          const targetModel = candidateModels[attempt];
          try {
            if (attempt > 0) {
              await new Promise((r) => setTimeout(r, 500 * attempt));
            }
            const stream = await ai.models.generateContentStream({
              model: targetModel,
              contents,
              config: {
                systemInstruction,
              },
            });

            for await (const chunk of stream) {
              if (clientAborted) break;
              const textChunk = chunk.text;
              if (textChunk) {
                streamedAnyText = true;
                sendSseEvent(res, { type: 'delta', text: textChunk });
              }
            }

            lastErr = null;
            break;
          } catch (attemptErr) {
            lastErr = attemptErr;
            if (streamedAnyText || !isTransientOverloadError(attemptErr)) {
              break;
            }
          }
        }

        if (lastErr && !clientAborted) {
          const formatted = formatUpstreamProviderError('gemini', lastErr, model);
          sendSseEvent(res, {
            type: 'error',
            message: formatted.message,
            code: formatted.code,
          });
        } else if (!clientAborted) {
          sendSseEvent(res, { type: 'done' });
        }
      } finally {
        if (!res.writableEnded) res.end();
      }
      return;
    }

    try {
      const openRouterMessages = buildOpenRouterMessages(messages, realtimeContextBlock);
      const callOpenRouter = (targetModelId: string) =>
        fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${openRouterKey!}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': process.env.APP_URL || 'http://localhost:3000',
            'X-Title': 'Nova AI',
          },
          body: JSON.stringify({
            model: targetModelId,
            stream: true,
            messages: openRouterMessages,
          }),
          signal: abortController.signal,
        });

      let upstreamRes = await callOpenRouter(model);
      if (
        !upstreamRes.ok &&
        (upstreamRes.status === 429 || upstreamRes.status === 502 || upstreamRes.status === 503) &&
        model !== 'openrouter/free' &&
        !clientAborted
      ) {
        upstreamRes = await callOpenRouter('openrouter/free');
      }

      if (!upstreamRes.ok) {
        let detail = `HTTP ${upstreamRes.status}`;
        try {
          const errJson = (await upstreamRes.json()) as { error?: { message?: string } };
          if (errJson?.error?.message) detail = `${upstreamRes.status}: ${errJson.error.message}`;
        } catch {
          // Ignore
        }
        const formatted = formatUpstreamProviderError('openrouter', new Error(detail), model);
        sendSseEvent(res, {
          type: 'error',
          message: formatted.message,
          code: formatted.code,
        });
        res.end();
        return;
      }

      if (!upstreamRes.body) {
        sendSseEvent(res, {
          type: 'error',
          message: 'OpenRouter returned an empty response stream.',
          code: 'EMPTY_STREAM',
        });
        res.end();
        return;
      }

      const reader = upstreamRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (!clientAborted) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line || line.startsWith(':')) continue;
          if (!line.startsWith('data:')) continue;

          const dataStr = line.slice(5).trim();
          if (dataStr === '[DONE]') continue;

          try {
            const parsed = JSON.parse(dataStr) as {
              error?: { message?: string };
              choices?: Array<{ delta?: { content?: string | null } }>;
            };
            if (parsed.error?.message) {
              throw new Error(parsed.error.message);
            }
            const delta = parsed.choices?.[0]?.delta?.content;
            if (typeof delta === 'string' && delta.length > 0) {
              sendSseEvent(res, { type: 'delta', text: delta });
            }
          } catch (parseErr) {
            if (parseErr instanceof Error && !(parseErr instanceof SyntaxError)) {
              throw parseErr;
            }
          }
        }
      }

      if (!clientAborted) {
        sendSseEvent(res, { type: 'done' });
      }
    } catch (err) {
      if (!clientAborted) {
        const formatted = formatUpstreamProviderError('openrouter', err, model);
        sendSseEvent(res, {
          type: 'error',
          message: formatted.message,
          code: formatted.code,
        });
      }
    } finally {
      if (!res.writableEnded) res.end();
    }
  });

  const httpServer = http.createServer(app);

  const liveWss = new WebSocketServer({
    noServer: true,
    maxPayload: 2 * 1024 * 1024,
  });

  httpServer.on('upgrade', (req, socket, head) => {
    try {
      const reqUrl = new URL(req.url || '/', 'http://localhost');
      if (reqUrl.pathname !== '/api/live') {
        return;
      }
      liveWss.handleUpgrade(req, socket, head, (clientWs) => {
        liveWss.emit('connection', clientWs, req);
      });
    } catch {
      socket.destroy();
    }
  });

  liveWss.on('connection', (clientWs, req) => {
    const sendWsJson = (payload: Record<string, unknown>) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify(payload));
      }
    };

    const xff = req.headers['x-forwarded-for'];
    const ip =
      typeof xff === 'string' && xff.trim()
        ? xff.split(',')[0].trim()
        : req.socket.remoteAddress || 'local';

    const rate = liveLimiter.check(ip);
    if (!rate.allowed) {
      sendWsJson({
        type: 'error',
        message: `Too many live voice sessions. Please wait ${rate.retryAfterSec}s and try again.`,
      });
      clientWs.close(1008, 'Rate limited');
      return;
    }

    const status = getProviderStatus();
    if (!status.geminiConfigured) {
      sendWsJson({
        type: 'error',
        message:
          'GEMINI_API_KEY is not configured on the server. Add GEMINI_API_KEY in Google AI Studio under Settings > Secrets.',
      });
      clientWs.close(1008, 'Missing GEMINI_API_KEY');
      return;
    }

    const reqUrl = new URL(req.url || '/', 'http://localhost');
    const voiceName = normalizeLiveVoice(reqUrl.searchParams.get('voice'));

    let isClosed = false;
    const ai = createGeminiClient();

    const pingInterval = setInterval(() => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.ping();
      }
    }, 25_000);

    const sessionPromise = ai.live.connect({
      model: 'gemini-3.8-live',
      callbacks: {
        onopen: () => {
          // Session socket opened; 'ready' is emitted once sessionPromise resolves
        },
        onmessage: (message: LiveServerMessage) => {
          if (isClosed) return;
          const serverContent = message.serverContent;
          if (!serverContent) return;

          if (serverContent.interrupted) {
            sendWsJson({ type: 'interrupted' });
          }

          if (serverContent.inputTranscription?.text) {
            sendWsJson({
              type: 'input_transcript',
              text: serverContent.inputTranscription.text,
            });
          }

          if (serverContent.outputTranscription?.text) {
            sendWsJson({
              type: 'output_transcript',
              text: serverContent.outputTranscription.text,
            });
          }

          const parts = serverContent.modelTurn?.parts;
          if (Array.isArray(parts)) {
            for (const part of parts) {
              const audioData = part.inlineData?.data;
              if (audioData) {
                sendWsJson({
                  type: 'audio',
                  audio: audioData,
                  mimeType: part.inlineData?.mimeType || 'audio/pcm;rate=24000',
                });
              }
            }
          }

          if (serverContent.turnComplete) {
            sendWsJson({ type: 'turn_complete' });
          }
        },
        onerror: (err: unknown) => {
          if (isClosed) return;
          const rawMsg =
            err instanceof Error
              ? err.message
              : typeof err === 'object' && err !== null && 'message' in err
              ? String((err as { message?: unknown }).message)
              : 'Live voice session encountered an upstream error.';
          sendWsJson({
            type: 'error',
            message: rawMsg || 'Live voice session encountered an upstream error.',
          });
        },
        onclose: () => {
          if (!isClosed && clientWs.readyState === WebSocket.OPEN) {
            sendWsJson({ type: 'session_closed' });
            clientWs.close(1000, 'Gemini Live session closed');
          }
        },
      },
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName,
            },
          },
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        systemInstruction:
          'You are Nova, a warm, responsive, and articulate real-time voice assistant. Speak naturally and concisely like a thoughtful conversation partner. Avoid reading markdown symbols or asterisks aloud.',
      },
    });

    sessionPromise
      .then(() => {
        if (!isClosed) {
          sendWsJson({ type: 'ready', voice: voiceName });
        }
      })
      .catch((err: unknown) => {
        if (isClosed) return;
        const formatted = formatUpstreamProviderError('gemini', err, 'gemini-3.8-live');
        sendWsJson({
          type: 'error',
          message: formatted.message,
        });
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.close(1011, 'Upstream connection failed');
        }
      });

    clientWs.on('message', (raw) => {
      if (isClosed) return;
      let parsed: {
        type?: unknown;
        audio?: unknown;
        text?: unknown;
      };
      try {
        const textData = typeof raw === 'string' ? raw : raw.toString('utf8');
        parsed = JSON.parse(textData) as typeof parsed;
      } catch {
        return;
      }

      sessionPromise
        .then((session) => {
          if (isClosed) return;
          if (
            parsed.type === 'audio' &&
            typeof parsed.audio === 'string' &&
            parsed.audio.length > 0 &&
            parsed.audio.length <= 512_000
          ) {
            session.sendRealtimeInput({
              audio: {
                data: parsed.audio,
                mimeType: 'audio/pcm;rate=16000',
              },
            });
          } else if (parsed.type === 'audio_stream_end') {
            session.sendRealtimeInput({
              audioStreamEnd: true,
            });
          } else if (
            parsed.type === 'text' &&
            typeof parsed.text === 'string' &&
            parsed.text.trim().length > 0 &&
            parsed.text.length <= 4_000
          ) {
            session.sendRealtimeInput({
              text: parsed.text.trim(),
            });
          }
        })
        .catch(() => {
          // Upstream connection error already handled above
        });
    });

    const cleanup = () => {
      if (isClosed) return;
      isClosed = true;
      clearInterval(pingInterval);
      sessionPromise
        .then((session) => {
          try {
            session.close();
          } catch {
            // Ignore close errors
          }
        })
        .catch(() => {
          // Ignore rejected session cleanup
        });
    };

    clientWs.on('close', cleanup);
    clientWs.on('error', cleanup);
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: {
          server: httpServer,
        },
        ws: {
          server: httpServer,
        },
        allowedHosts: true,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Nova AI server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Nova AI server:', err);
  process.exit(1);
});
