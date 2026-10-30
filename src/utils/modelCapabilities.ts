import type { AttachmentItem, ModelInfo } from '../types/nova.ts';

export const MAX_ATTACHMENTS_PER_MESSAGE = 4;
export const MAX_ATTACHMENT_SIZE_BYTES = 6 * 1024 * 1024; // 6 MB per file
export const MAX_TOTAL_ATTACHMENT_BYTES = 12 * 1024 * 1024; // 12 MB total

export const DEFAULT_GEMINI_MODEL_ID = 'gemini-3.1-flash-lite';

export const GEMINI_CHAT_MODELS: ModelInfo[] = [
  {
    id: 'gemini-3.1-flash-lite',
    name: 'Gemini 3.1 Flash Lite',
    vendor: 'Google',
    provider: 'gemini',
    description: 'Ultra-low-latency free model optimized for instant answers, coding, and documents.',
    contextLength: 1048576,
    supportsVision: false,
    supportsDocuments: true,
    supportsStreaming: true,
    isFree: true,
  },
];

export function isAllowedFreeGeminiChatModel(modelId: string): boolean {
  return GEMINI_CHAT_MODELS.some((m) => m.id === modelId);
}

/**
 * Excludes removed OpenRouter models:
 * - Gemma models (Gemma 2 / Gemma 4 variants)
 * - Nemotron 3.5 models (Content Safety, Super VL, Lightning)
 * - Cohere North Mini Code
 * - Thinking Machines Inkling / Inkling Small
 */
export function isExcludedOpenRouterModel(id: string, name = ''): boolean {
  const lowerId = id.trim().toLowerCase();
  const haystack = `${lowerId} ${name.trim().toLowerCase()}`;

  if (/\bgemma\b/.test(haystack) || lowerId.includes('gemma')) {
    return true;
  }
  if (/nemotron[-_\s]*3\.5/.test(haystack)) {
    return true;
  }
  if (/north[-_\s]*mini[-_\s]*code/.test(haystack)) {
    return true;
  }
  if (/\binkling\b/.test(haystack) || lowerId.startsWith('thinkingmachines/inkling')) {
    return true;
  }
  return false;
}

interface RawOpenRouterModel {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  context_length?: unknown;
  architecture?: {
    modality?: unknown;
    input_modalities?: unknown;
    output_modalities?: unknown;
  };
  pricing?: {
    prompt?: unknown;
    completion?: unknown;
    request?: unknown;
    image?: unknown;
  };
}

const FEATURED_FREE_PREFIXES = [
  'openrouter/free',
  'meta-llama/',
  'deepseek/',
  'qwen/',
  'nvidia/',
  'mistralai/',
  'poolside/',
  'liquid/',
];

function formatVendorAndName(id: string, rawName: string): { vendor: string; cleanName: string } {
  const withoutFreeTag = rawName.replace(/\s*\(free\)\s*$/i, '').replace(/\s{2,}/g, ' ').trim();
  const colonIdx = withoutFreeTag.indexOf(':');
  if (colonIdx > 0 && colonIdx < 28) {
    const vendor = withoutFreeTag.slice(0, colonIdx).trim();
    const rest = withoutFreeTag.slice(colonIdx + 1).trim();
    if (vendor && rest) {
      return { vendor, cleanName: rest };
    }
  }

  const slashPrefix = id.split('/')[0] || 'OpenRouter';
  const vendorMap: Record<string, string> = {
    openrouter: 'OpenRouter',
    google: 'Google',
    nvidia: 'NVIDIA',
    'meta-llama': 'Meta',
    deepseek: 'DeepSeek',
    cohere: 'Cohere',
    qwen: 'Qwen',
    mistralai: 'Mistral',
    poolside: 'Poolside',
    liquid: 'LiquidAI',
    'dots-studio': 'Dots Studio',
    recursive: 'Recursive',
    'xingchen-agi': 'XingChen',
  };

  return {
    vendor: vendorMap[slashPrefix.toLowerCase()] || slashPrefix,
    cleanName: withoutFreeTag || id,
  };
}

export function normalizeOpenRouterModels(
  rawList: unknown,
  options: { freeOnly?: boolean } = { freeOnly: true }
): {
  chatModels: ModelInfo[];
} {
  if (!Array.isArray(rawList)) {
    return { chatModels: [] };
  }

  const freeOnly = options.freeOnly !== false;
  const chatModels: ModelInfo[] = [];

  for (const item of rawList as RawOpenRouterModel[]) {
    if (!item || typeof item.id !== 'string' || !item.id.trim()) continue;
    const id = item.id.trim();
    const rawName = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : id;

    if (isExcludedOpenRouterModel(id, rawName)) {
      continue;
    }

    const inputMods = Array.isArray(item.architecture?.input_modalities)
      ? item.architecture.input_modalities.filter((m): m is string => typeof m === 'string')
      : [];
    const outputMods = Array.isArray(item.architecture?.output_modalities)
      ? item.architecture.output_modalities.filter((m): m is string => typeof m === 'string')
      : [];
    const modalityStr = typeof item.architecture?.modality === 'string' ? item.architecture.modality : '';

    // Exclude audio/music generation endpoints unless explicitly marked :free
    const isPaidAudioEndpoint = outputMods.includes('audio') && !id.endsWith(':free');

    const promptPrice = typeof item.pricing?.prompt === 'string' ? parseFloat(item.pricing.prompt) : NaN;
    const completionPrice =
      typeof item.pricing?.completion === 'string' ? parseFloat(item.pricing.completion) : NaN;
    const requestPrice = typeof item.pricing?.request === 'string' ? parseFloat(item.pricing.request) : 0;
    const imagePrice = typeof item.pricing?.image === 'string' ? parseFloat(item.pricing.image) : 0;

    const isZeroPriced =
      promptPrice === 0 &&
      completionPrice === 0 &&
      (Number.isNaN(requestPrice) || requestPrice === 0) &&
      (Number.isNaN(imagePrice) || imagePrice === 0);

    const isFree =
      !isPaidAudioEndpoint && (id === 'openrouter/free' || id.endsWith(':free') || isZeroPriced);

    if (freeOnly && !isFree) {
      continue;
    }

    const supportsDocuments = inputMods.includes('file');
    const supportsTextOutput =
      outputMods.length === 0 || outputMods.includes('text') || modalityStr.includes('->text');

    if (!supportsTextOutput) {
      continue;
    }

    const descRaw = typeof item.description === 'string' ? item.description.trim() : '';
    const firstSentence =
      descRaw.split(/(?<=\.)\s+/)[0] ||
      (id === 'openrouter/free'
        ? 'Automatically routes prompts to high-performing free models on OpenRouter.'
        : 'Free OpenRouter hosted model.');
    const description = firstSentence.length > 140 ? `${firstSentence.slice(0, 137)}...` : firstSentence;

    const contextLength =
      typeof item.context_length === 'number' && Number.isFinite(item.context_length)
        ? item.context_length
        : undefined;

    const { vendor, cleanName } = formatVendorAndName(id, rawName);

    chatModels.push({
      id,
      name: cleanName,
      vendor,
      provider: 'openrouter',
      description,
      contextLength,
      supportsVision: false,
      supportsDocuments,
      supportsStreaming: true,
      isFree,
    });
  }

  const scoreModel = (m: ModelInfo): number => {
    if (m.id === 'openrouter/free') return 1000;
    let score = 0;
    const idx = FEATURED_FREE_PREFIXES.findIndex((p) => m.id.startsWith(p));
    if (idx !== -1) score += (FEATURED_FREE_PREFIXES.length - idx) * 10;
    if (m.contextLength && m.contextLength >= 100_000) score += 2;
    return score;
  };

  chatModels.sort((a, b) => scoreModel(b) - scoreModel(a) || a.name.localeCompare(b.name));

  return { chatModels };
}

export interface AttachmentValidationResult {
  valid: boolean;
  reason?: string;
  incompatibleAttachmentIds: string[];
}

export function validateAttachmentsForModel(
  model: ModelInfo | undefined,
  attachments: AttachmentItem[]
): AttachmentValidationResult {
  if (!attachments || attachments.length === 0) {
    return { valid: true, incompatibleAttachmentIds: [] };
  }

  if (attachments.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    return {
      valid: false,
      reason: `You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files per message.`,
      incompatibleAttachmentIds: attachments.slice(MAX_ATTACHMENTS_PER_MESSAGE).map((a) => a.id),
    };
  }

  let totalBytes = 0;
  for (const att of attachments) {
    totalBytes += att.sizeBytes;
    if (att.sizeBytes > MAX_ATTACHMENT_SIZE_BYTES) {
      return {
        valid: false,
        reason: `"${att.name}" exceeds the 6 MB per-file limit.`,
        incompatibleAttachmentIds: [att.id],
      };
    }
  }

  if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
    return {
      valid: false,
      reason: 'Total attachment size exceeds the 12 MB limit per message.',
      incompatibleAttachmentIds: attachments.map((a) => a.id),
    };
  }

  const incompatibleIds: string[] = [];
  const reasons: string[] = [];

  for (const att of attachments) {
    if (att.kind === 'image') {
      incompatibleIds.push(att.id);
      reasons.push(
        'Vision and image uploads are disabled. Please attach text, code, Markdown, JSON, CSV, or PDF files.'
      );
    } else if (model && att.kind === 'document' && !model.supportsDocuments && !att.textContent) {
      incompatibleIds.push(att.id);
      reasons.push(
        `${model.name} does not support binary PDF uploads. Switch to Gemini 3.1 Flash Lite or upload a plain text/Markdown file.`
      );
    }
  }

  if (incompatibleIds.length > 0) {
    return {
      valid: false,
      reason: reasons[0],
      incompatibleAttachmentIds: incompatibleIds,
    };
  }

  return { valid: true, incompatibleAttachmentIds: [] };
}

export function formatContextWindow(tokens?: number): string | null {
  if (!tokens || tokens <= 0) return null;
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M ctx`;
  }
  if (tokens >= 1_000) {
    return `${Math.round(tokens / 1_000)}K ctx`;
  }
  return `${tokens} ctx`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
