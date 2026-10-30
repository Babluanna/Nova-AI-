/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Moon, Plus, Sun, WifiOff } from 'lucide-react';
import {
  ThemePreference,
  type AttachmentItem,
  type ChatMessage,
  type Conversation,
  type LivePulseSnapshot,
  type LiveTurnRecord,
  type LiveVoiceName,
  type ModelInfo,
  type ModelsApiResponse,
  type OpenRouterKeyStorageMode,
  type OpenRouterVerifyResponse,
  type ProviderStatus,
  type RealtimeSource,
} from './types/nova.ts';
import {
  DEFAULT_GEMINI_MODEL_ID,
  GEMINI_CHAT_MODELS,
  isExcludedOpenRouterModel,
} from './utils/modelCapabilities.ts';
import { normalizeLiveVoice } from './utils/liveAudio.ts';
import {
  maskApiKey,
  normalizeAndValidateOpenRouterKey,
} from './utils/apiValidation.ts';
import {
  clearUserOpenRouterKey,
  loadUserOpenRouterKey,
  saveUserOpenRouterKey,
} from './utils/openRouterKeyStore.ts';
import {
  clearSavedConversations,
  createConversation,
  deriveConversationTitle,
  generateId,
  loadActiveConversationId,
  loadSavedConversations,
  saveActiveConversationId,
  saveConversations,
} from './utils/conversationStore.ts';
import {
  useOnlineStatus,
  usePWAInstall,
  useTheme,
} from './hooks/usePWAInstall.ts';
import { Sidebar } from './components/Sidebar.tsx';
import { ChatView } from './components/ChatView.tsx';
import { ModelSelectorModal } from './components/ModelSelectorModal.tsx';
import { SetupAndPWAModal } from './components/SetupAndPWAModal.tsx';
import { LiveVoiceModal } from './components/LiveVoiceModal.tsx';

const OPENROUTER_FREE_ROUTER_ID = 'openrouter/free';

export default function App() {
  const { theme, setTheme, resolvedDark } = useTheme();
  const isOnline = useOnlineStatus();
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [modelModalOpen, setModelModalOpen] = useState(false);
  const [setupModalOpen, setSetupModalOpen] = useState(false);
  const [liveVoiceOpen, setLiveVoiceOpen] = useState(false);
  const [liveVoiceName, setLiveVoiceName] = useState<LiveVoiceName>(() => {
    try {
      return normalizeLiveVoice(localStorage.getItem('nova-live-voice'));
    } catch {
      return 'Zephyr';
    }
  });

  // Real-Time Live Data toggle (enabled by default)
  const [realtimeEnabled, setRealtimeEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('nova-realtime-enabled');
      return saved === null ? true : saved === 'true';
    } catch {
      return true;
    }
  });
  const [livePulse, setLivePulse] = useState<LivePulseSnapshot | null>(null);

  // User-entered OpenRouter API key (browser-scoped, proxied to server over HTTPS)
  const initialStoredKey = useMemo(() => loadUserOpenRouterKey(), []);
  const [userOpenRouterKey, setUserOpenRouterKey] = useState<string>(
    initialStoredKey?.key || ''
  );
  const [keyStorageMode, setKeyStorageMode] = useState<OpenRouterKeyStorageMode>(
    initialStoredKey?.storageMode || 'local'
  );

  // Models & provider status (100% Free-Only)
  const [geminiModels, setGeminiModels] = useState<ModelInfo[]>(GEMINI_CHAT_MODELS);
  const [openRouterModels, setOpenRouterModels] = useState<ModelInfo[]>([]);
  const [openRouterError, setOpenRouterError] = useState<string | undefined>();
  const [providerStatus, setProviderStatus] = useState<ProviderStatus>({
    geminiConfigured: true,
    openRouterServerConfigured: false,
    openRouterConfigured: Boolean(initialStoredKey?.key),
  });
  const [isRefreshingModels, setIsRefreshingModels] = useState(false);

  const hasUserOpenRouterKey = Boolean(userOpenRouterKey.trim());
  const maskedUserKey = useMemo(() => maskApiKey(userOpenRouterKey), [userOpenRouterKey]);
  const openRouterConnected =
    hasUserOpenRouterKey || providerStatus.openRouterServerConfigured;

  // Saved conversations persisted locally (defaults to OpenRouter Free Router when an OpenRouter key is saved)
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    const saved = loadSavedConversations();
    if (saved.length > 0) return saved;
    if (initialStoredKey?.key) {
      return [createConversation(OPENROUTER_FREE_ROUTER_ID, 'openrouter')];
    }
    return [createConversation(DEFAULT_GEMINI_MODEL_ID, 'gemini')];
  });

  const [activeConversationId, setActiveConversationId] = useState<string>(() => {
    const savedId = loadActiveConversationId();
    const savedList = loadSavedConversations();
    if (savedId && savedList.some((c) => c.id === savedId)) {
      return savedId;
    }
    return savedList[0]?.id || '';
  });

  const currentConversation = useMemo(() => {
    const found = conversations.find((c) => c.id === activeConversationId);
    return found || conversations[0];
  }, [conversations, activeConversationId]);

  useEffect(() => {
    if (currentConversation && currentConversation.id !== activeConversationId) {
      setActiveConversationId(currentConversation.id);
    }
  }, [currentConversation, activeConversationId]);

  useEffect(() => {
    saveConversations(conversations);
  }, [conversations]);

  useEffect(() => {
    saveActiveConversationId(currentConversation?.id || null);
  }, [currentConversation?.id]);

  const handleToggleRealtime = useCallback(() => {
    setRealtimeEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('nova-realtime-enabled', String(next));
      } catch {
        // Ignore storage quota issues
      }
      return next;
    });
  }, []);

  const handleToggleHeaderTheme = useCallback(() => {
    setTheme(resolvedDark ? ThemePreference.LIGHT : ThemePreference.DARK);
  }, [resolvedDark, setTheme]);

  const handleChangeLiveVoice = useCallback((voice: LiveVoiceName) => {
    const normalized = normalizeLiveVoice(voice);
    setLiveVoiceName(normalized);
    try {
      localStorage.setItem('nova-live-voice', normalized);
    } catch {
      // Ignore storage quota issues
    }
  }, []);

  // Load real-time world & market pulse snapshot
  useEffect(() => {
    let active = true;
    const loadPulse = async () => {
      try {
        const resp = await fetch('/api/realtime/pulse');
        if (!resp.ok) return;
        const data = (await resp.json()) as LivePulseSnapshot;
        if (active) setLivePulse(data);
      } catch {
        // Non-blocking ambient pulse
      }
    };
    void loadPulse();
    const interval = window.setInterval(() => {
      void loadPulse();
    }, 120_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  const fetchModelsCatalog = useCallback(
    async (forceRefresh = false, overrideKey?: string) => {
      setIsRefreshingModels(true);
      try {
        const keyToSend = overrideKey !== undefined ? overrideKey : userOpenRouterKey;
        const headers: Record<string, string> = {};
        if (keyToSend.trim()) {
          headers['X-OpenRouter-Key'] = keyToSend.trim();
        }
        const resp = await fetch(forceRefresh ? '/api/models?refresh=1' : '/api/models', {
          headers,
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = (await resp.json()) as ModelsApiResponse;
        if (Array.isArray(data.gemini) && data.gemini.length > 0) {
          setGeminiModels(data.gemini);
        }
        if (Array.isArray(data.openrouter)) {
          setOpenRouterModels(data.openrouter);
        }
        setOpenRouterError(data.openRouterError);
        if (data.status) {
          setProviderStatus(data.status);
          // If server has OPENROUTER_API_KEY configured and current empty chat is on default model, enable OpenRouter Free Router
          if (data.status.openRouterServerConfigured) {
            setConversations((prev) =>
              prev.map((c, idx) =>
                idx === 0 && c.messages.length === 0 && c.modelId === DEFAULT_GEMINI_MODEL_ID
                  ? { ...c, modelId: OPENROUTER_FREE_ROUTER_ID, provider: 'openrouter' }
                  : c
              )
            );
          }
        }
      } catch (err) {
        setOpenRouterError(err instanceof Error ? err.message : 'Unable to fetch models.');
      } finally {
        setIsRefreshingModels(false);
      }
    },
    [userOpenRouterKey]
  );

  useEffect(() => {
    void fetchModelsCatalog(false);
  }, [fetchModelsCatalog]);

  const allChatModels = useMemo(
    () => [...geminiModels, ...openRouterModels],
    [geminiModels, openRouterModels]
  );

  const activeModel = useMemo(
    () => allChatModels.find((m) => m.id === currentConversation?.modelId) || geminiModels[0],
    [allChatModels, currentConversation?.modelId, geminiModels]
  );

  // Migrate any legacy removed Gemini or excluded OpenRouter model ID stored in older conversations
  useEffect(() => {
    if (!currentConversation) return;
    if (
      currentConversation.provider === 'gemini' &&
      !geminiModels.some((m) => m.id === currentConversation.modelId)
    ) {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === currentConversation.id
            ? { ...c, modelId: DEFAULT_GEMINI_MODEL_ID, provider: 'gemini' }
            : c
        )
      );
      return;
    }

    if (
      currentConversation.provider === 'openrouter' &&
      isExcludedOpenRouterModel(currentConversation.modelId)
    ) {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === currentConversation.id
            ? { ...c, modelId: OPENROUTER_FREE_ROUTER_ID, provider: 'openrouter' }
            : c
        )
      );
    }
  }, [currentConversation, geminiModels]);

  // Save & verify OpenRouter API key entered directly in the app and activate OpenRouter Real-Time model
  const handleSaveOpenRouterKey = useCallback(
    async (
      rawKey: string,
      storageMode: OpenRouterKeyStorageMode
    ): Promise<{ ok: boolean; message?: string; error?: string }> => {
      const normalized = normalizeAndValidateOpenRouterKey(rawKey);
      if (!normalized.ok) {
        return { ok: false, error: normalized.error };
      }

      const activateOpenRouterOnCurrentChat = () => {
        if (!currentConversation) return;
        if (currentConversation.provider !== 'openrouter') {
          setConversations((prev) =>
            prev.map((c) =>
              c.id === currentConversation.id
                ? { ...c, modelId: OPENROUTER_FREE_ROUTER_ID, provider: 'openrouter' }
                : c
            )
          );
        }
      };

      try {
        const resp = await fetch('/api/openrouter/verify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-OpenRouter-Key': normalized.key,
          },
          body: JSON.stringify({}),
        });

        const data = (await resp.json()) as OpenRouterVerifyResponse;
        if (!resp.ok || !data.valid) {
          return {
            ok: false,
            error:
              data.error ||
              'OpenRouter rejected this API key. Check your key at openrouter.ai/settings/keys.',
          };
        }

        const saved = saveUserOpenRouterKey(normalized.key, storageMode);
        if (!saved.ok) {
          return { ok: false, error: saved.error };
        }

        setUserOpenRouterKey(saved.key);
        setKeyStorageMode(storageMode);
        setProviderStatus((prev) => ({ ...prev, openRouterConfigured: true }));
        activateOpenRouterOnCurrentChat();
        void fetchModelsCatalog(true, saved.key);

        return {
          ok: true,
          message:
            data.warning ||
            (data.label
              ? `Verified with OpenRouter (${data.label}) · Switched to OpenRouter for real-time data.`
              : 'OpenRouter API key verified · Real-time OpenRouter models active.'),
        };
      } catch {
        const saved = saveUserOpenRouterKey(normalized.key, storageMode);
        if (!saved.ok) {
          return { ok: false, error: saved.error };
        }
        setUserOpenRouterKey(saved.key);
        setKeyStorageMode(storageMode);
        setProviderStatus((prev) => ({ ...prev, openRouterConfigured: true }));
        activateOpenRouterOnCurrentChat();
        return {
          ok: true,
          message: 'OpenRouter key saved locally and activated for real-time chat.',
        };
      }
    },
    [currentConversation, fetchModelsCatalog]
  );

  const handleSaveQuickOpenRouterKey = useCallback(
    async (rawKey: string): Promise<{ ok: boolean; error?: string }> => {
      const res = await handleSaveOpenRouterKey(rawKey, keyStorageMode);
      return { ok: res.ok, error: res.error };
    },
    [handleSaveOpenRouterKey, keyStorageMode]
  );

  const handleDisconnectOpenRouterKey = useCallback(() => {
    clearUserOpenRouterKey();
    setUserOpenRouterKey('');
    setProviderStatus((prev) => ({
      ...prev,
      openRouterConfigured: prev.openRouterServerConfigured,
    }));
  }, []);

  // Streaming state
  const [isStreaming, setIsStreaming] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleStopStreaming = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  const handleNewChat = useCallback(() => {
    if (isStreaming) handleStopStreaming();
    const defaultProvider = openRouterConnected
      ? activeModel?.provider || 'openrouter'
      : activeModel?.provider || 'gemini';
    const defaultModel =
      defaultProvider === 'openrouter'
        ? activeModel?.provider === 'openrouter'
          ? activeModel.id
          : OPENROUTER_FREE_ROUTER_ID
        : activeModel?.id || DEFAULT_GEMINI_MODEL_ID;

    if (currentConversation && currentConversation.messages.length === 0) {
      return;
    }

    const fresh = createConversation(defaultModel, defaultProvider);
    setConversations((prev) => [fresh, ...prev]);
    setActiveConversationId(fresh.id);
  }, [activeModel, currentConversation, handleStopStreaming, isStreaming, openRouterConnected]);

  const handleSelectSavedConversation = useCallback(
    (id: string) => {
      if (isStreaming) handleStopStreaming();
      setActiveConversationId(id);
    },
    [handleStopStreaming, isStreaming]
  );

  const handleSelectModel = useCallback(
    (model: ModelInfo) => {
      if (!currentConversation) return;
      setConversations((prev) =>
        prev.map((c) =>
          c.id === currentConversation.id
            ? { ...c, modelId: model.id, provider: model.provider }
            : c
        )
      );
    },
    [currentConversation]
  );

  const handleQuickSelectGeminiFlash = useCallback(() => {
    const flash =
      geminiModels.find((m) => m.id === DEFAULT_GEMINI_MODEL_ID) || GEMINI_CHAT_MODELS[0];
    handleSelectModel(flash);
  }, [geminiModels, handleSelectModel]);

  const handleQuickSelectOpenRouterFree = useCallback(() => {
    const routerModel = openRouterModels.find((m) => m.id === OPENROUTER_FREE_ROUTER_ID) || {
      id: OPENROUTER_FREE_ROUTER_ID,
      name: 'Free Models Router',
      vendor: 'OpenRouter',
      provider: 'openrouter' as const,
      description: 'Automatically routes prompts to healthy free OpenRouter models with live data.',
      supportsVision: false,
      supportsDocuments: false,
      supportsStreaming: true,
      isFree: true,
    };
    handleSelectModel(routerModel);
  }, [handleSelectModel, openRouterModels]);

  const streamConversationResponse = useCallback(
    async (
      convId: string,
      provider: 'gemini' | 'openrouter',
      modelId: string,
      historyMessages: ChatMessage[],
      assistantMsgId: string,
      useRealtime: boolean
    ) => {
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setIsStreaming(true);

      const updateAssistantMessage = (updater: (msg: ChatMessage) => ChatMessage) => {
        setConversations((prev) =>
          prev.map((conv) => {
            if (conv.id !== convId) return conv;
            return {
              ...conv,
              updatedAt: Date.now(),
              messages: conv.messages.map((m) => (m.id === assistantMsgId ? updater(m) : m)),
            };
          })
        );
      };

      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (provider === 'openrouter' && userOpenRouterKey.trim()) {
          headers['X-OpenRouter-Key'] = userOpenRouterKey.trim();
        }

        const resp = await fetch('/api/chat/stream', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            provider,
            model: modelId,
            realtime: useRealtime,
            messages: historyMessages
              .filter((m) => !m.isError)
              .map((m) => ({
                role: m.role,
                content: m.content,
                attachments: m.attachments,
              })),
          }),
          signal: controller.signal,
        });

        if (!resp.ok) {
          let errText = `Request failed with HTTP ${resp.status}.`;
          let errCode = 'HTTP_ERROR';
          try {
            const errJson = (await resp.json()) as { error?: string; code?: string };
            if (errJson?.error) errText = errJson.error;
            if (errJson?.code) errCode = errJson.code;
          } catch {
            // Ignore
          }
          updateAssistantMessage((m) => ({
            ...m,
            content: errText,
            isError: true,
            errorCode: errCode,
            statusText: undefined,
          }));
          return;
        }

        if (!resp.body) {
          updateAssistantMessage((m) => ({
            ...m,
            content: 'Server returned an empty response stream.',
            isError: true,
            statusText: undefined,
          }));
          return;
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line.startsWith('data:')) continue;
            const jsonStr = line.slice(5).trim();
            if (!jsonStr) continue;

            try {
              const event = JSON.parse(jsonStr) as {
                type: 'delta' | 'done' | 'error' | 'status' | 'sources';
                text?: string;
                message?: string;
                code?: string;
                sources?: RealtimeSource[];
              };

              if (event.type === 'status' && event.text) {
                updateAssistantMessage((m) => ({
                  ...m,
                  statusText: event.text,
                }));
              } else if (event.type === 'sources' && Array.isArray(event.sources)) {
                updateAssistantMessage((m) => ({
                  ...m,
                  sources: event.sources,
                  usedRealtimeData: true,
                }));
              } else if (event.type === 'delta' && event.text) {
                updateAssistantMessage((m) => ({
                  ...m,
                  content: m.content + event.text,
                  statusText: undefined,
                }));
              } else if (event.type === 'error') {
                updateAssistantMessage((m) => ({
                  ...m,
                  content: event.message || 'An upstream model error occurred.',
                  isError: true,
                  errorCode: event.code,
                  statusText: undefined,
                }));
              }
            } catch {
              // Ignore malformed partial chunk
            }
          }
        }
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') {
          updateAssistantMessage((m) => ({
            ...m,
            content: m.content || 'Generation stopped.',
            stopped: true,
            statusText: undefined,
          }));
        } else {
          updateAssistantMessage((m) => ({
            ...m,
            content:
              err instanceof Error
                ? `Network error: ${err.message}`
                : 'Connection interrupted while streaming response.',
            isError: true,
            statusText: undefined,
          }));
        }
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
        setIsStreaming(false);
      }
    },
    [userOpenRouterKey]
  );

  const handleSendMessage = useCallback(
    (content: string, attachments: AttachmentItem[], forceRealtime?: boolean) => {
      if (!currentConversation || isStreaming) return;

      // When OpenRouter is connected and user triggers a live briefing without attachments, prefer OpenRouter if still on default
      let targetModel = activeModel || geminiModels[0];
      if (
        forceRealtime &&
        openRouterConnected &&
        attachments.length === 0 &&
        currentConversation.messages.length === 0 &&
        targetModel.provider !== 'openrouter'
      ) {
        targetModel =
          openRouterModels.find((m) => m.id === OPENROUTER_FREE_ROUTER_ID) || {
            id: OPENROUTER_FREE_ROUTER_ID,
            name: 'Free Models Router',
            vendor: 'OpenRouter',
            provider: 'openrouter',
            description: 'Automatically routes prompts to healthy free OpenRouter models.',
            supportsVision: false,
            supportsDocuments: false,
            supportsStreaming: true,
            isFree: true,
          };
      }

      const useRealtime = forceRealtime ?? realtimeEnabled;
      if (forceRealtime && !realtimeEnabled) {
        setRealtimeEnabled(true);
        try {
          localStorage.setItem('nova-realtime-enabled', 'true');
        } catch {
          // Ignore
        }
      }

      const now = Date.now();
      const userMsg: ChatMessage = {
        id: generateId('msg'),
        role: 'user',
        content: content.trim(),
        attachments: attachments.length > 0 ? attachments : undefined,
        createdAt: now,
      };

      const assistantPlaceholder: ChatMessage = {
        id: generateId('msg'),
        role: 'assistant',
        content: '',
        modelId: targetModel.id,
        provider: targetModel.provider,
        usedRealtimeData: useRealtime,
        statusText: useRealtime ? 'Gathering live real-time data…' : 'Composing response…',
        createdAt: now + 1,
      };

      const updatedHistory = [...currentConversation.messages, userMsg];
      const nextTitle =
        !currentConversation.isCustomTitle && currentConversation.messages.length === 0
          ? deriveConversationTitle(content, attachments[0]?.name)
          : currentConversation.title;

      setConversations((prev) =>
        prev.map((c) =>
          c.id === currentConversation.id
            ? {
                ...c,
                title: nextTitle,
                modelId: targetModel.id,
                provider: targetModel.provider,
                updatedAt: now,
                messages: [...updatedHistory, assistantPlaceholder],
              }
            : c
        )
      );

      void streamConversationResponse(
        currentConversation.id,
        targetModel.provider,
        targetModel.id,
        updatedHistory,
        assistantPlaceholder.id,
        useRealtime
      );
    },
    [
      activeModel,
      currentConversation,
      geminiModels,
      isStreaming,
      openRouterConnected,
      openRouterModels,
      realtimeEnabled,
      streamConversationResponse,
    ]
  );

  const handleRegenerateLast = useCallback(() => {
    if (!currentConversation || isStreaming) return;
    const msgs = currentConversation.messages;
    if (msgs.length === 0) return;

    const baseMessages =
      msgs[msgs.length - 1].role === 'assistant' ? msgs.slice(0, -1) : [...msgs];
    if (baseMessages.length === 0) return;

    const targetModel = activeModel || geminiModels[0];
    const now = Date.now();
    const assistantPlaceholder: ChatMessage = {
      id: generateId('msg'),
      role: 'assistant',
      content: '',
      modelId: targetModel.id,
      provider: targetModel.provider,
      usedRealtimeData: realtimeEnabled,
      statusText: realtimeEnabled ? 'Gathering live real-time data…' : 'Composing response…',
      createdAt: now,
    };

    setConversations((prev) =>
      prev.map((c) =>
        c.id === currentConversation.id
          ? {
              ...c,
              modelId: targetModel.id,
              provider: targetModel.provider,
              updatedAt: now,
              messages: [...baseMessages, assistantPlaceholder],
            }
          : c
      )
    );

    void streamConversationResponse(
      currentConversation.id,
      targetModel.provider,
      targetModel.id,
      baseMessages,
      assistantPlaceholder.id,
      realtimeEnabled
    );
  }, [
    activeModel,
    currentConversation,
    geminiModels,
    isStreaming,
    realtimeEnabled,
    streamConversationResponse,
  ]);

  const handleRenameConversation = useCallback((id: string, title: string) => {
    setConversations((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, title, isCustomTitle: true, updatedAt: Date.now() } : c
      )
    );
  }, []);

  const handleTogglePinConversation = useCallback((id: string) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c))
    );
  }, []);

  const handleDeleteConversation = useCallback(
    (id: string) => {
      if (isStreaming && id === currentConversation?.id) {
        handleStopStreaming();
      }
      setConversations((prev) => {
        const remaining = prev.filter((c) => c.id !== id);
        if (remaining.length === 0) {
          const fresh = createConversation(
            activeModel?.id || DEFAULT_GEMINI_MODEL_ID,
            activeModel?.provider || 'gemini'
          );
          setActiveConversationId(fresh.id);
          return [fresh];
        }
        if (id === currentConversation?.id) {
          setActiveConversationId(remaining[0].id);
        }
        return remaining;
      });
    },
    [activeModel, currentConversation?.id, handleStopStreaming, isStreaming]
  );

  const handleClearHistory = useCallback(() => {
    if (isStreaming) handleStopStreaming();
    clearSavedConversations();
    const fresh = createConversation(
      activeModel?.id || DEFAULT_GEMINI_MODEL_ID,
      activeModel?.provider || 'gemini'
    );
    setConversations([fresh]);
    setActiveConversationId(fresh.id);
  }, [activeModel, handleStopStreaming, isStreaming]);

  const handleRecordLiveTurn = useCallback(
    (turn: LiveTurnRecord) => {
      if (!currentConversation) return;
      const userContent = turn.userText.trim();
      const assistantContent = turn.assistantText.trim();
      if (!userContent && !assistantContent) return;

      const now = Date.now();
      const appended: ChatMessage[] = [];

      if (userContent) {
        appended.push({
          id: generateId('msg'),
          role: 'user',
          content: userContent,
          createdAt: now,
        });
      }

      if (assistantContent) {
        appended.push({
          id: generateId('msg'),
          role: 'assistant',
          content: assistantContent,
          modelId: 'nova-live',
          provider: 'gemini',
          createdAt: now + 1,
        });
      }

      const nextTitle =
        !currentConversation.isCustomTitle && currentConversation.messages.length === 0
          ? deriveConversationTitle(userContent || assistantContent)
          : currentConversation.title;

      const targetId = currentConversation.id;
      setConversations((prev) =>
        prev.map((c) =>
          c.id === targetId
            ? {
                ...c,
                title: nextTitle,
                updatedAt: now,
                messages: [...c.messages, ...appended],
              }
            : c
        )
      );
    },
    [currentConversation]
  );

  const hasActiveMessages = currentConversation.messages.length > 0;

  return (
    <div className="nova-luxury-canvas flex h-dvh w-full overflow-hidden text-[#181715] dark:text-[#F2EFE9]">
      <Sidebar
        conversations={conversations}
        activeConversationId={currentConversation.id}
        onSelectConversation={handleSelectSavedConversation}
        onNewChat={handleNewChat}
        onRenameConversation={handleRenameConversation}
        onTogglePinConversation={handleTogglePinConversation}
        onDeleteConversation={handleDeleteConversation}
        onClearHistory={handleClearHistory}
        theme={theme}
        onChangeTheme={setTheme}
        openRouterConnected={openRouterConnected}
        hasUserOpenRouterKey={hasUserOpenRouterKey}
        onOpenModelSelector={() => setModelModalOpen(true)}
        onOpenSetupModal={() => setSetupModalOpen(true)}
        isInstallable={isInstallable}
        isInstalled={isInstalled}
        onTriggerInstall={() => void install()}
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />

      {/* Main Sanctuary Canvas */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Serene Minimalist Top Bar (Puppet/Ghost Icon Removed) */}
        <header className="flex h-14 shrink-0 items-center justify-between gap-4 px-3 sm:px-5">
          {/* Top-Left: Editorial 3-Line Menu Trigger */}
          <div className="flex items-center">
            <button
              type="button"
              onClick={() => setDrawerOpen((v) => !v)}
              aria-label={drawerOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={drawerOpen}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full text-[#181715] transition-colors hover:bg-[#ECE8DF] dark:text-[#F2EFE9] dark:hover:bg-[#22201C]"
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <line x1="4" y1="6.5" x2="20" y2="6.5" />
                <line x1="4" y1="12" x2="20" y2="12" />
                <line x1="4" y1="17.5" x2="12.5" y2="17.5" />
              </svg>
            </button>
          </div>

          {/* Center: Quiet Thread Title during Active Chat */}
          <div className="min-w-0 flex-1 text-center">
            {hasActiveMessages && (
              <span className="inline-block max-w-[220px] truncate text-sm font-medium text-[#5C5952] sm:max-w-md dark:text-[#A39E93]">
                {currentConversation.title}
              </span>
            )}
          </div>

          {/* Top-Right: Calm Night/Day Sanctuary Toggle (+ Live Voice & New Chat when in thread) */}
          <div className="flex shrink-0 items-center gap-1">
            {hasActiveMessages && (
              <>
                <button
                  type="button"
                  onClick={() => setLiveVoiceOpen(true)}
                  aria-label="Open Nova Live voice"
                  title="Nova Live voice"
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full text-[#181715] transition-colors hover:bg-[#ECE8DF] dark:text-[#F2EFE9] dark:hover:bg-[#22201C]"
                >
                  <svg
                    width="19"
                    height="19"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <line x1="4" y1="11" x2="4" y2="13" />
                    <line x1="8" y1="8" x2="8" y2="16" />
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="16" y1="9" x2="16" y2="15" />
                    <line x1="20" y1="11" x2="20" y2="13" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={handleNewChat}
                  aria-label="New chat"
                  title="New chat"
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full text-[#181715] transition-colors hover:bg-[#ECE8DF] dark:text-[#F2EFE9] dark:hover:bg-[#22201C]"
                >
                  <Plus className="h-5 w-5 stroke-[1.85]" />
                </button>
              </>
            )}

            <button
              type="button"
              onClick={handleToggleHeaderTheme}
              aria-label={resolvedDark ? 'Switch to warm daylight mode' : 'Switch to calm nocturne dark mode'}
              title={resolvedDark ? 'Switch to daylight mode' : 'Switch to calm nocturne mode'}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full text-[#5C5952] transition-colors hover:bg-[#ECE8DF] hover:text-[#181715] dark:text-[#C8C2B6] dark:hover:bg-[#22201C] dark:hover:text-[#F2EFE9]"
            >
              {resolvedDark ? (
                <Sun className="h-[19px] w-[19px] stroke-[1.75]" />
              ) : (
                <Moon className="h-[19px] w-[19px] stroke-[1.75]" />
              )}
            </button>
          </div>
        </header>

        {/* Offline Connectivity Banner */}
        {!isOnline && (
          <div
            role="status"
            className="flex items-center justify-center gap-2 bg-amber-600 px-4 py-1.5 text-xs font-medium text-white"
          >
            <WifiOff className="h-3.5 w-3.5" />
            <span>
              Offline Mode — Local conversation history is available; live AI requests require connectivity.
            </span>
          </div>
        )}

        {/* Active Chat Workspace */}
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <ChatView
            conversation={currentConversation}
            activeModel={activeModel}
            allModels={allChatModels}
            openRouterConnected={openRouterConnected}
            hasUserOpenRouterKey={hasUserOpenRouterKey}
            realtimeEnabled={realtimeEnabled}
            onToggleRealtime={handleToggleRealtime}
            livePulse={livePulse}
            isStreaming={isStreaming}
            onSendMessage={handleSendMessage}
            onStopStreaming={handleStopStreaming}
            onRegenerateLast={handleRegenerateLast}
            onOpenModelSelector={() => setModelModalOpen(true)}
            onOpenKeySettings={() => setSetupModalOpen(true)}
            onQuickSelectGeminiFlash={handleQuickSelectGeminiFlash}
            onQuickSelectOpenRouterFree={handleQuickSelectOpenRouterFree}
            onOpenLiveVoice={() => setLiveVoiceOpen(true)}
          />
        </main>
      </div>

      {/* Modals */}
      <LiveVoiceModal
        isOpen={liveVoiceOpen}
        onClose={() => setLiveVoiceOpen(false)}
        selectedVoice={liveVoiceName}
        onChangeVoice={handleChangeLiveVoice}
        onRecordTurn={handleRecordLiveTurn}
      />

      <ModelSelectorModal
        isOpen={modelModalOpen}
        onClose={() => setModelModalOpen(false)}
        selectedModelId={activeModel?.id || currentConversation.modelId}
        onSelectModel={handleSelectModel}
        geminiModels={geminiModels}
        openRouterModels={openRouterModels}
        openRouterError={openRouterError}
        providerStatus={providerStatus}
        hasUserOpenRouterKey={hasUserOpenRouterKey}
        maskedUserKey={maskedUserKey}
        onSaveQuickOpenRouterKey={handleSaveQuickOpenRouterKey}
        onOpenFullKeySettings={() => setSetupModalOpen(true)}
        isRefreshing={isRefreshingModels}
        onRefreshModels={() => void fetchModelsCatalog(true)}
      />

      <SetupAndPWAModal
        isOpen={setupModalOpen}
        onClose={() => setSetupModalOpen(false)}
        providerStatus={providerStatus}
        openRouterModelCount={openRouterModels.length}
        hasUserOpenRouterKey={hasUserOpenRouterKey}
        maskedUserKey={maskedUserKey}
        keyStorageMode={keyStorageMode}
        onSaveOpenRouterKey={handleSaveOpenRouterKey}
        onDisconnectOpenRouterKey={handleDisconnectOpenRouterKey}
        isInstallable={isInstallable}
        isInstalled={isInstalled}
        isIOS={isIOS}
        onInstallPWA={install}
      />
    </div>
  );
}
