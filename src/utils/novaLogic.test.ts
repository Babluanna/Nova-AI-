import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_GEMINI_MODEL_ID,
  GEMINI_CHAT_MODELS,
  isAllowedFreeGeminiChatModel,
  isExcludedOpenRouterModel,
  normalizeOpenRouterModels,
  validateAttachmentsForModel,
  formatContextWindow,
} from './modelCapabilities.ts';
import {
  createConversation,
  deriveConversationTitle,
  filterAndSearchConversations,
  groupConversationsByDate,
  migrateConversationModel,
} from './conversationStore.ts';
import {
  RateLimiter,
  extractCleanErrorMessage,
  formatUpstreamProviderError,
  maskApiKey,
  normalizeAndValidateOpenRouterKey,
  validateChatRequest,
  isSecretConfigured,
} from './apiValidation.ts';
import { classifyFileKind, tokenizeCode } from './syntaxHighlight.ts';
import {
  base64ToFloat32Pcm,
  computeRmsLevel,
  downsampleFloat32ToInt16Pcm,
  int16PcmToBase64,
  normalizeLiveVoice,
} from './liveAudio.ts';
import {
  decodeXmlEntities,
  detectRealtimeIntents,
  extractSearchKeywords,
  parseGoogleNewsRss,
} from './realtimeData.ts';
import type { AttachmentItem, ModelInfo } from '../types/nova.ts';

test('Gemini catalog contains strictly Gemini 3.1 Flash Lite without Vision and excludes Gemini Flash, Gemini 3.8, and paid models', () => {
  assert.equal(DEFAULT_GEMINI_MODEL_ID, 'gemini-3.1-flash-lite');
  assert.equal(GEMINI_CHAT_MODELS.length, 1);
  assert.equal(GEMINI_CHAT_MODELS[0].id, 'gemini-3.1-flash-lite');
  assert.equal(GEMINI_CHAT_MODELS[0].supportsVision, false);
  assert.equal(GEMINI_CHAT_MODELS[0].isFree, true);
  assert.equal(isAllowedFreeGeminiChatModel('gemini-3.1-flash-lite'), true);
  assert.equal(isAllowedFreeGeminiChatModel('gemini-flash-latest'), false);
  assert.equal(isAllowedFreeGeminiChatModel('gemini-3.8-flash'), false);
  assert.equal(isAllowedFreeGeminiChatModel('gemini-4-argon'), false);
});

test('migrateConversationModel upgrades removed Gemini Flash and excluded OpenRouter models cleanly', () => {
  const legacyGemini = createConversation('gemini-flash-latest', 'gemini', 1000);
  const migratedGemini = migrateConversationModel(legacyGemini);
  assert.equal(migratedGemini.modelId, 'gemini-3.1-flash-lite');
  assert.equal(migratedGemini.provider, 'gemini');

  const excludedGemma = createConversation('google/gemma-4-31b-it:free', 'openrouter', 1000);
  assert.equal(migrateConversationModel(excludedGemma).modelId, 'openrouter/free');

  const excludedInkling = createConversation('thinkingmachines/inkling:free', 'openrouter', 1000);
  assert.equal(migrateConversationModel(excludedInkling).modelId, 'openrouter/free');

  const openRouterConv = createConversation('openrouter/free', 'openrouter', 1000);
  assert.equal(migrateConversationModel(openRouterConv).modelId, 'openrouter/free');
});

test('normalizeOpenRouterModels excludes Gemma, Nemotron 3.5, North Mini Code, Inkling, paid models, and disables Vision', () => {
  assert.equal(isExcludedOpenRouterModel('google/gemma-4-26b-a4b-it:free'), true);
  assert.equal(isExcludedOpenRouterModel('google/gemma-2-9b-it:free'), true);
  assert.equal(isExcludedOpenRouterModel('nvidia/nemotron-3.5-super-vl:free'), true);
  assert.equal(isExcludedOpenRouterModel('nvidia/nemotron-3.5-lightning:free'), true);
  assert.equal(isExcludedOpenRouterModel('nvidia/nemotron-3.5-content-safety:free'), true);
  assert.equal(isExcludedOpenRouterModel('cohere/north-mini-code:free'), true);
  assert.equal(isExcludedOpenRouterModel('thinkingmachines/inkling:free'), true);
  assert.equal(isExcludedOpenRouterModel('thinkingmachines/inkling-small:free'), true);
  assert.equal(isExcludedOpenRouterModel('nvidia/nemotron-3-ultra-550b-a55b:free'), false);

  const sample = [
    {
      id: 'anthropic/claude-sonnet-4',
      name: 'Anthropic: Claude Sonnet 4',
      context_length: 200000,
      architecture: { input_modalities: ['text', 'image', 'file'], output_modalities: ['text'] },
      pricing: { prompt: '0.000003', completion: '0.000015' },
    },
    {
      id: 'google/gemma-4-31b-it:free',
      name: 'Google: Gemma 4 31B (free)',
      context_length: 131072,
      architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
      pricing: { prompt: '0', completion: '0' },
    },
    {
      id: 'nvidia/nemotron-3.5-lightning:free',
      name: 'NVIDIA: Nemotron 3.5 Lightning (free)',
      context_length: 131072,
      architecture: { input_modalities: ['text'], output_modalities: ['text'] },
      pricing: { prompt: '0', completion: '0' },
    },
    {
      id: 'cohere/north-mini-code:free',
      name: 'Cohere: North Mini Code (free)',
      context_length: 131072,
      architecture: { input_modalities: ['text'], output_modalities: ['text'] },
      pricing: { prompt: '0', completion: '0' },
    },
    {
      id: 'thinkingmachines/inkling:free',
      name: 'Thinking Machines: Inkling (free)',
      context_length: 131072,
      architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
      pricing: { prompt: '0', completion: '0' },
    },
    {
      id: 'poolside/laguna-s-2.1:free',
      name: 'Poolside: Laguna S 2.1 (free)',
      context_length: 131072,
      architecture: { input_modalities: ['text'], output_modalities: ['text'] },
      pricing: { prompt: '0', completion: '0' },
    },
    {
      id: 'openrouter/free',
      name: 'Free Models Router',
      architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
      pricing: { prompt: '0', completion: '0' },
    },
  ];

  const { chatModels } = normalizeOpenRouterModels(sample);
  assert.equal(chatModels.length, 2);
  assert.equal(chatModels[0].id, 'openrouter/free');
  assert.equal(chatModels[1].id, 'poolside/laguna-s-2.1:free');
  assert.ok(chatModels.every((m) => m.isFree === true && m.supportsVision === false));
  assert.equal(formatContextWindow(chatModels[1].contextLength), '131K ctx');
});

test('normalizeAndValidateOpenRouterKey and maskApiKey validate and mask user keys cleanly', () => {
  const valid = normalizeAndValidateOpenRouterKey('  Bearer sk-or-v1-1234567890abcdef1234  ');
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.key, 'sk-or-v1-1234567890abcdef1234');
    assert.equal(maskApiKey(valid.key), 'sk-or-v1-••••••••1234');
  }

  assert.equal(normalizeAndValidateOpenRouterKey('sk-short').ok, false);
  assert.equal(normalizeAndValidateOpenRouterKey('sk-or-v1-abc def ghi jkl mno').ok, false);
});

test('validateAttachmentsForModel blocks all image/vision uploads and validates documents/text cleanly', () => {
  const textOnlyModel: ModelInfo = {
    id: 'poolside/laguna-s-2.1:free',
    name: 'Laguna S 2.1',
    provider: 'openrouter',
    description: 'Free coding model',
    supportsVision: false,
    supportsDocuments: false,
    supportsStreaming: true,
    isFree: true,
  };

  const imageAtt: AttachmentItem = {
    id: 'a1',
    name: 'diagram.png',
    mimeType: 'image/png',
    sizeBytes: 12000,
    kind: 'image',
    dataUrl: 'data:image/png;base64,AAA',
  };

  const textFileAtt: AttachmentItem = {
    id: 'a2',
    name: 'notes.md',
    mimeType: 'text/markdown',
    sizeBytes: 800,
    kind: 'text',
    textContent: '# Notes',
  };

  const pdfAtt: AttachmentItem = {
    id: 'a3',
    name: 'spec.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 42000,
    kind: 'document',
    base64Data: 'JVBERi0=',
  };

  const geminiLite = GEMINI_CHAT_MODELS[0];
  assert.equal(validateAttachmentsForModel(geminiLite, [imageAtt]).valid, false);
  assert.equal(validateAttachmentsForModel(textOnlyModel, [imageAtt]).valid, false);

  assert.equal(validateAttachmentsForModel(textOnlyModel, [textFileAtt]).valid, true);
  assert.equal(validateAttachmentsForModel(textOnlyModel, [pdfAtt]).valid, false);
  assert.equal(validateAttachmentsForModel(geminiLite, [pdfAtt, textFileAtt]).valid, true);
});

test('conversation title derivation, filtering, search, and date grouping work deterministically', () => {
  const title = deriveConversationTitle('```ts\nconst x = 1;\n```\n  How do I optimize PostgreSQL indexes for JSONB queries in production?  ');
  assert.ok(title.startsWith('How do I optimize PostgreSQL'));
  assert.ok(title.length <= 53);

  const now = new Date('2026-10-28T12:00:00Z').getTime();
  const c1 = {
    ...createConversation('gemini-3.1-flash-lite', 'gemini', now - 1000),
    title: 'SwiftUI Layout Guide',
    pinned: true,
  };
  const c2 = {
    ...createConversation('openrouter/free', 'openrouter', now - 3600_000),
    title: 'Rust Async Channels',
    messages: [
      { id: 'm1', role: 'user' as const, content: 'Explain tokio mpsc backpressure', createdAt: now - 3600_000 },
    ],
  };
  const c3 = {
    ...createConversation('gemini-3.1-flash-lite', 'gemini', now - 10 * 86400_000),
    title: 'Quarterly Budget',
  };

  const searchTokio = filterAndSearchConversations([c1, c2, c3], 'backpressure', 'all');
  assert.equal(searchTokio.length, 1);
  assert.equal(searchTokio[0].id, c2.id);

  const openRouterOnly = filterAndSearchConversations([c1, c2, c3], '', 'openrouter');
  assert.equal(openRouterOnly.length, 1);
  assert.equal(openRouterOnly[0].id, c2.id);

  const groups = groupConversationsByDate(filterAndSearchConversations([c1, c2, c3], '', 'all'), now);
  assert.deepEqual(
    groups.map((g) => g.label),
    ['Pinned', 'Today', 'Earlier']
  );
});

test('API request validation, RateLimiter, syntaxHighlight, and error formatting enforce bounds', () => {
  assert.equal(isSecretConfigured(undefined, 'MY_GEMINI_API_KEY'), false);
  assert.equal(isSecretConfigured('AIzaRealSecretKeyExample', 'MY_GEMINI_API_KEY'), true);

  const goodChat = validateChatRequest({
    provider: 'gemini',
    model: 'gemini-3.1-flash-lite',
    messages: [{ role: 'user', content: 'Hello Nova!' }],
  });
  assert.equal(goodChat.ok, true);

  const limiter = new RateLimiter(10_000, 2);
  assert.equal(limiter.check('127.0.0.1', 1000).allowed, true);
  assert.equal(limiter.check('127.0.0.1', 2000).allowed, true);
  assert.equal(limiter.check('127.0.0.1', 3000).allowed, false);

  assert.equal(classifyFileKind('photo.webp', 'image/webp'), 'image');
  const tokens = tokenizeCode('const count = 42; // total');
  assert.ok(tokens.some((t) => t.type === 'keyword' && t.value === 'const'));

  const nestedRaw =
    'ApiError: {"error":{"message":"{\\n\\"error\\": {\\n\\"code\\": 503,\\n\\"message\\": \\"Spikes in demand are temporary.\\"\\n}}"}}';
  assert.equal(extractCleanErrorMessage(nestedRaw), 'Spikes in demand are temporary.');

  const orAuth = formatUpstreamProviderError('openrouter', new Error('401 User not found'), 'openrouter/free');
  assert.equal(orAuth.status, 401);
  assert.equal(orAuth.code, 'OPENROUTER_UNAUTHORIZED');
});

test('liveAudio normalizes voices, downsamples 48kHz to 16kHz PCM16, and round-trips Base64 PCM cleanly', () => {
  assert.equal(normalizeLiveVoice('kore'), 'Kore');
  assert.equal(normalizeLiveVoice('Puck'), 'Puck');
  assert.equal(normalizeLiveVoice('unknown-voice'), 'Zephyr');
  assert.equal(normalizeLiveVoice(null), 'Zephyr');

  const samples48k = new Float32Array(480);
  for (let i = 0; i < samples48k.length; i++) {
    samples48k[i] = Math.sin((2 * Math.PI * 440 * i) / 48000) * 0.5;
  }
  const pcm16k = downsampleFloat32ToInt16Pcm(samples48k, 48000, 16000);
  assert.equal(pcm16k.length, 160);

  const directInput = new Float32Array([-1, -0.5, 0, 0.5, 0.99]);
  const encoded = int16PcmToBase64(downsampleFloat32ToInt16Pcm(directInput, 16000, 16000));
  const decoded = base64ToFloat32Pcm(encoded);
  assert.equal(decoded.length, directInput.length);
  for (let i = 0; i < directInput.length; i++) {
    assert.ok(Math.abs(decoded[i] - directInput[i]) < 0.001);
  }

  assert.equal(computeRmsLevel(new Float32Array([0, 0, 0])), 0);
  assert.ok(computeRmsLevel(samples48k) > 0.5);
});

test('realtimeData parses RSS news items, extracts search keywords, detects weather/market/tech intents, and validates realtime flag', () => {
  assert.equal(decodeXmlEntities('AI &amp; Chips: &quot;Next Wave&quot; &#39;26'), 'AI & Chips: "Next Wave" \'26');

  const kw = extractSearchKeywords('What is the latest news about OpenRouter free AI models?');
  assert.ok(kw.toLowerCase().includes('openrouter'));

  const wx1 = detectRealtimeIntents('What is the current weather in Tokyo and Bitcoin price right now?');
  assert.deepEqual(wx1.weatherCities, ['Tokyo']);
  assert.equal(wx1.wantsMarkets, true);

  const wx2 = detectRealtimeIntents('London weather today');
  assert.deepEqual(wx2.weatherCities, ['London']);

  const wxMulti = detectRealtimeIntents(
    'Compare the current live weather conditions in Tokyo, London, and New York right now.'
  );
  assert.deepEqual(wxMulti.weatherCities, ['Tokyo', 'London', 'New York']);

  const mkt = detectRealtimeIntents('Summarize live Bitcoin and USD EUR exchange rate');
  assert.equal(mkt.wantsMarkets, true);

  const tech = detectRealtimeIntents('Latest OpenRouter and NVIDIA GPU releases');
  assert.equal(tech.wantsTech, true);

  const sampleRss = `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0"><channel>
      <item>
        <title>Global Clean Energy Hits Record Milestone - Reuters</title>
        <link>https://news.google.com/rss/articles/example1</link>
        <pubDate>Fri, 30 Oct 2026 12:00:00 GMT</pubDate>
        <source url="https://www.reuters.com">Reuters</source>
      </item>
    </channel></rss>`;

  const parsed = parseGoogleNewsRss(sampleRss, 5);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].title, 'Global Clean Energy Hits Record Milestone');
  assert.equal(parsed[0].publisher, 'Reuters');
  assert.equal(parsed[0].url, 'https://news.google.com/rss/articles/example1');

  const rtDefault = validateChatRequest({
    provider: 'openrouter',
    model: 'openrouter/free',
    messages: [{ role: 'user', content: 'Latest headlines' }],
  });
  assert.equal(rtDefault.ok, true);
  if (rtDefault.ok) {
    assert.equal(rtDefault.data.realtime, true);
  }

  const rtDisabled = validateChatRequest({
    provider: 'openrouter',
    model: 'openrouter/free',
    realtime: false,
    messages: [{ role: 'user', content: 'Write a haiku' }],
  });
  assert.equal(rtDisabled.ok, true);
  if (rtDisabled.ok) {
    assert.equal(rtDisabled.data.realtime, false);
  }
});

