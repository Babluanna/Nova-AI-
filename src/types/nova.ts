export type ProviderId = 'gemini' | 'openrouter';

export enum ThemePreference {
  SYSTEM = 'system',
  LIGHT = 'light',
  DARK = 'dark',
}

export type ConversationFilter = 'all' | 'pinned' | 'gemini' | 'openrouter';

export type OpenRouterKeyStorageMode = 'local' | 'session';

export type LiveVoiceName = 'Zephyr' | 'Kore' | 'Puck' | 'Charon' | 'Fenrir';

export interface LiveTurnRecord {
  userText: string;
  assistantText: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  vendor?: string;
  provider: ProviderId;
  description: string;
  contextLength?: number;
  supportsVision: boolean;
  supportsDocuments: boolean;
  supportsStreaming: boolean;
  isFree: boolean;
}

export interface AttachmentItem {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  kind: 'image' | 'document' | 'text';
  /** Data URL for previewing images or sending binary PDFs */
  dataUrl?: string;
  /** Raw base64 payload without data:...;base64, prefix */
  base64Data?: string;
  /** Extracted UTF-8 text for plain-text, code, CSV, JSON, and Markdown files */
  textContent?: string;
}

export interface RealtimeSource {
  title: string;
  url: string;
  publisher: string;
  publishedAt?: string;
}

export interface LivePulseSnapshot {
  updatedAtIso: string;
  btcUsd?: string;
  ethUsd?: string;
  headlines: RealtimeSource[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: AttachmentItem[];
  modelId?: string;
  provider?: ProviderId;
  createdAt: number;
  isError?: boolean;
  errorCode?: string;
  stopped?: boolean;
  sources?: RealtimeSource[];
  usedRealtimeData?: boolean;
  statusText?: string;
}

export interface Conversation {
  id: string;
  title: string;
  isCustomTitle?: boolean;
  modelId: string;
  provider: ProviderId;
  messages: ChatMessage[];
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ProviderStatus {
  geminiConfigured: boolean;
  openRouterServerConfigured: boolean;
  openRouterConfigured: boolean;
}

export interface ModelsApiResponse {
  gemini: ModelInfo[];
  openrouter: ModelInfo[];
  openRouterError?: string;
  status: ProviderStatus;
}

export interface OpenRouterVerifyResponse {
  valid: boolean;
  label?: string;
  isFreeTier?: boolean;
  warning?: string;
  error?: string;
}
