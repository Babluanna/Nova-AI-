import type {
  Conversation,
  ConversationFilter,
  ProviderId,
} from '../types/nova.ts';
import {
  DEFAULT_GEMINI_MODEL_ID,
  isAllowedFreeGeminiChatModel,
  isExcludedOpenRouterModel,
} from './modelCapabilities.ts';

const STORAGE_KEY = 'nova_ai_conversations_v1';
const ACTIVE_ID_KEY = 'nova_ai_active_conversation_v1';

export function generateId(prefix = 'id'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export function createConversation(
  modelId = DEFAULT_GEMINI_MODEL_ID,
  provider: ProviderId = 'gemini',
  now = Date.now()
): Conversation {
  return {
    id: generateId('conv'),
    title: 'New Chat',
    isCustomTitle: false,
    modelId,
    provider,
    messages: [],
    pinned: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function migrateConversationModel(conv: Conversation): Conversation {
  if (conv.provider === 'gemini' && !isAllowedFreeGeminiChatModel(conv.modelId)) {
    return {
      ...conv,
      modelId: DEFAULT_GEMINI_MODEL_ID,
      provider: 'gemini',
    };
  }
  if (conv.provider === 'openrouter' && isExcludedOpenRouterModel(conv.modelId)) {
    return {
      ...conv,
      modelId: 'openrouter/free',
      provider: 'openrouter',
    };
  }
  return conv;
}

export function deriveConversationTitle(prompt: string, fallbackAttachmentName?: string): string {
  const cleaned = prompt
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`~\n\r]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) {
    if (fallbackAttachmentName) {
      return `Analysis: ${fallbackAttachmentName}`.slice(0, 56);
    }
    return 'New Chat';
  }

  if (cleaned.length <= 52) return cleaned;
  const sliced = cleaned.slice(0, 52);
  const lastSpace = sliced.lastIndexOf(' ');
  return `${(lastSpace > 24 ? sliced.slice(0, lastSpace) : sliced).trim()}…`;
}

export function filterAndSearchConversations(
  conversations: Conversation[],
  searchQuery: string,
  filter: ConversationFilter
): Conversation[] {
  const q = searchQuery.trim().toLowerCase();

  return conversations
    .filter((conv) => {
      if (filter === 'pinned' && !conv.pinned) return false;
      if (filter === 'gemini' && conv.provider !== 'gemini') return false;
      if (filter === 'openrouter' && conv.provider !== 'openrouter') return false;

      if (!q) return true;
      if (conv.title.toLowerCase().includes(q)) return true;
      if (conv.modelId.toLowerCase().includes(q)) return true;
      return conv.messages.some((m) => m.content.toLowerCase().includes(q));
    })
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });
}

export interface ConversationGroup {
  label: string;
  items: Conversation[];
}

export function groupConversationsByDate(
  conversations: Conversation[],
  now = Date.now()
): ConversationGroup[] {
  const pinned: Conversation[] = [];
  const today: Conversation[] = [];
  const last7Days: Conversation[] = [];
  const earlier: Conversation[] = [];

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const todayMs = startOfToday.getTime();
  const sevenDaysAgoMs = todayMs - 7 * 24 * 60 * 60 * 1000;

  for (const conv of conversations) {
    if (conv.pinned) {
      pinned.push(conv);
    } else if (conv.updatedAt >= todayMs) {
      today.push(conv);
    } else if (conv.updatedAt >= sevenDaysAgoMs) {
      last7Days.push(conv);
    } else {
      earlier.push(conv);
    }
  }

  const groups: ConversationGroup[] = [];
  if (pinned.length > 0) groups.push({ label: 'Pinned', items: pinned });
  if (today.length > 0) groups.push({ label: 'Today', items: today });
  if (last7Days.length > 0) groups.push({ label: 'Previous 7 Days', items: last7Days });
  if (earlier.length > 0) groups.push({ label: 'Earlier', items: earlier });
  return groups;
}

export function loadSavedConversations(): Conversation[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (c): c is Conversation =>
          Boolean(c && typeof c.id === 'string' && typeof c.title === 'string' && Array.isArray(c.messages))
      )
      .map(migrateConversationModel);
  } catch {
    return [];
  }
}

/**
 * Safely persists conversations to localStorage. If large base64 attachments
 * exceed browser storage quota, strips raw binary payloads from older saved copies
 * while preserving attachment metadata and text content so history never breaks.
 */
export function saveConversations(conversations: Conversation[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
  } catch {
    try {
      const compact = conversations.map((c) => ({
        ...c,
        messages: c.messages.map((m) => ({
          ...m,
          attachments: m.attachments?.map((att) => ({
            ...att,
            base64Data: undefined,
            dataUrl: att.kind === 'image' && att.dataUrl && att.dataUrl.length < 180_000 ? att.dataUrl : undefined,
          })),
        })),
      }));
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(compact));
    } catch {
      // Storage completely full; keep in-memory state intact without crashing UI
    }
  }
}

export function loadActiveConversationId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(ACTIVE_ID_KEY);
  } catch {
    return null;
  }
}

export function saveActiveConversationId(id: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (id) {
      window.localStorage.setItem(ACTIVE_ID_KEY, id);
    } else {
      window.localStorage.removeItem(ACTIVE_ID_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

export function clearSavedConversations(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(ACTIVE_ID_KEY);
  } catch {
    // Ignore
  }
}
