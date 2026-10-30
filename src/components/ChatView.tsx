import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUp,
  ArrowUpRight,
  Check,
  Copy,
  FileText,
  Globe,
  KeyRound,
  Loader2,
  Mic,
  Plus,
  RotateCcw,
  Square,
  X,
} from 'lucide-react';
import type {
  AttachmentItem,
  ChatMessage,
  Conversation,
  LivePulseSnapshot,
  ModelInfo,
} from '../types/nova.ts';
import {
  DEFAULT_GEMINI_MODEL_ID,
  formatBytes,
  validateAttachmentsForModel,
} from '../utils/modelCapabilities.ts';
import { classifyFileKind, readFileAsAttachment } from '../utils/syntaxHighlight.ts';
import { MarkdownRenderer } from './MarkdownRenderer.tsx';

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
}

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

function getSpeechRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return win.SpeechRecognition || win.webkitSpeechRecognition || null;
}

function getTimeGreeting(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'Good morning, how are things?';
  if (hour >= 12 && hour < 17) return 'Good afternoon, how are things?';
  if (hour >= 17 && hour < 22) return 'Good evening, how are things?';
  return 'Quiet evening, what is on your mind?';
}

const LIVE_BRIEFING_STARTERS = [
  {
    title: 'Global Headlines',
    subtitle: 'Calm executive summary of breaking world stories',
    prompt:
      'Give me a calm, well-structured executive briefing of the top global news stories happening right now, citing publishers.',
  },
  {
    title: 'AI & Tech Today',
    subtitle: 'Latest model releases, startups, and engineering news',
    prompt:
      'What are the most notable AI, software, and technology developments making news right now?',
  },
  {
    title: 'Live Markets & FX',
    subtitle: 'Current Bitcoin, Ethereum, and major currency rates',
    prompt:
      'Summarize current live Bitcoin, Ethereum, Solana spot prices and major USD foreign exchange rates right now.',
  },
  {
    title: 'World Weather',
    subtitle: 'Live conditions in Tokyo, London, and New York',
    prompt:
      'Compare the current live weather conditions in Tokyo, London, and New York right now.',
  },
] as const;

interface ChatViewProps {
  conversation: Conversation;
  activeModel: ModelInfo | undefined;
  allModels: ModelInfo[];
  openRouterConnected: boolean;
  hasUserOpenRouterKey: boolean;
  realtimeEnabled: boolean;
  onToggleRealtime: () => void;
  livePulse: LivePulseSnapshot | null;
  isStreaming: boolean;
  onSendMessage: (
    content: string,
    attachments: AttachmentItem[],
    forceRealtime?: boolean
  ) => void;
  onStopStreaming: () => void;
  onRegenerateLast: () => void;
  onOpenModelSelector: () => void;
  onOpenKeySettings: () => void;
  onQuickSelectGeminiFlash: () => void;
  onQuickSelectOpenRouterFree: () => void;
  onOpenLiveVoice: () => void;
}

export const ChatView: React.FC<ChatViewProps> = ({
  conversation,
  activeModel,
  allModels,
  openRouterConnected,
  hasUserOpenRouterKey,
  realtimeEnabled,
  onToggleRealtime,
  livePulse,
  isStreaming,
  onSendMessage,
  onStopStreaming,
  onRegenerateLast,
  onOpenModelSelector,
  onOpenKeySettings,
  onQuickSelectGeminiFlash,
  onQuickSelectOpenRouterFree,
  onOpenLiveVoice,
}) => {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [greeting] = useState<string>(() => getTimeGreeting());

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const bottomAnchorRef = useRef<HTMLDivElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  const capabilityCheck = validateAttachmentsForModel(activeModel, attachments);
  const needsOpenRouterKeyBanner =
    activeModel?.provider === 'openrouter' && !openRouterConnected;

  useEffect(() => {
    bottomAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [conversation.messages.length, isStreaming]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [input]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  const toggleVoiceDictation = () => {
    setVoiceNotice(null);

    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
      return;
    }

    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      textareaRef.current?.focus();
      setVoiceNotice('Voice dictation is not supported in this browser — type your message below.');
      return;
    }

    try {
      const recognition = new Ctor();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = navigator.language || 'en-US';

      const baseText = input.trim();
      recognition.onresult = (event) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        const cleaned = transcript.trim();
        if (cleaned) {
          setInput(baseText ? `${baseText} ${cleaned}` : cleaned);
        }
      };

      recognition.onerror = () => {
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
        textareaRef.current?.focus();
      };

      recognitionRef.current = recognition;
      setIsListening(true);
      recognition.start();
    } catch {
      setIsListening(false);
      textareaRef.current?.focus();
      setVoiceNotice('Unable to start microphone dictation in this environment.');
    }
  };

  const handleFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadError(null);

    const incoming = Array.from(files);
    if (attachments.length + incoming.length > 4) {
      setUploadError('You can attach up to 4 files per message.');
      return;
    }

    try {
      const parsed: AttachmentItem[] = [];
      for (const file of incoming) {
        if (classifyFileKind(file.name, file.type || '') === 'image') {
          setUploadError('Vision and image uploads are disabled. Please attach PDF, code, or text files.');
          continue;
        }
        if (file.size > 6 * 1024 * 1024) {
          setUploadError(`"${file.name}" exceeds the 6 MB file size limit.`);
          continue;
        }
        const item = await readFileAsAttachment(file);
        parsed.push(item);
      }
      if (parsed.length > 0) {
        setAttachments((prev) => [...prev, ...parsed]);
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Could not read selected file.');
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (isStreaming) return;
    if (!input.trim() && attachments.length === 0) return;
    if (!capabilityCheck.valid) return;

    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
    }

    onSendMessage(input, attachments);
    setInput('');
    setAttachments([]);
    setUploadError(null);
    setVoiceNotice(null);
  };

  const handleCopyMessage = async (msg: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(msg.content);
      setCopiedMsgId(msg.id);
      setTimeout(() => setCopiedMsgId(null), 1800);
    } catch {
      // Ignore clipboard failure
    }
  };

  const resolveModelLabel = (modelId?: string) => {
    if (!modelId) return activeModel?.name || 'Nova AI';
    if (modelId === 'nova-live' || modelId === 'gemini-3.8-live') return 'Nova Live';
    return allModels.find((m) => m.id === modelId)?.name || modelId;
  };

  const formatTime = (ts: number) => {
    try {
      return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  const lastAssistantIdx = [...conversation.messages]
    .map((m, idx) => ({ role: m.role, idx }))
    .filter((x) => x.role === 'assistant')
    .pop()?.idx;

  const hasPromptReady = input.trim().length > 0 || attachments.length > 0;

  return (
    <div
      className="nova-luxury-canvas relative flex flex-1 flex-col overflow-hidden"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        void handleFilesSelected(e.dataTransfer.files);
      }}
    >
      {isDragging && (
        <div className="pointer-events-none absolute inset-3 z-30 flex items-center justify-center rounded-3xl border-2 border-dashed border-[#181715]/35 bg-[#F2EFE8]/85 backdrop-blur-xs dark:border-[#F2EFE9]/35 dark:bg-[#1E1C18]/85">
          <p className="text-sm font-medium text-[#181715] dark:text-[#F2EFE9]">
            Drop PDFs, code, or text files to attach
          </p>
        </div>
      )}

      {/* Scrollable Message Stream / Centered Editorial Sanctuary */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6">
        <div className="mx-auto flex min-h-full max-w-2xl flex-col lg:max-w-3xl">
          {conversation.messages.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center py-8 sm:py-12 text-center">
              <h1 className="font-serif-editorial max-w-xl text-[30px] font-normal leading-[1.18] tracking-[-0.015em] text-[#181715] sm:text-[38px] dark:text-[#F2EFE9] [text-wrap:balance]">
                {greeting}
              </h1>

              {/* Subtle OpenRouter & Real-Time Control Row */}
              <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={onOpenKeySettings}
                  aria-label="Manage free plan and OpenRouter API key"
                  className="inline-flex min-h-[42px] items-center justify-center rounded-full border border-[#E5E0D5] bg-[#F2EFE8]/90 px-4 py-2 text-[13.5px] transition-colors hover:bg-[#EAE5DA] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#181715]/20 active:scale-[0.99] dark:border-[#2A2822] dark:bg-[#191815] dark:hover:bg-[#22201C] dark:focus-visible:ring-[#F2EFE9]/25"
                >
                  <span className="text-[#6F6B62] dark:text-[#9E9A90]">
                    {openRouterConnected ? 'OpenRouter Live ·' : 'Free plan ·'}
                  </span>
                  <span className="ml-1.5 font-semibold text-[#181715] dark:text-[#F2EFE9]">
                    {hasUserOpenRouterKey
                      ? 'Key active'
                      : openRouterConnected
                        ? 'Connected'
                        : 'Connect OpenRouter Key'}
                  </span>
                </button>

                {openRouterConnected && activeModel?.provider !== 'openrouter' && (
                  <button
                    type="button"
                    onClick={onQuickSelectOpenRouterFree}
                    className="inline-flex min-h-[42px] items-center justify-center rounded-full border border-[#D4A373]/40 bg-[#D4A373]/12 px-4 py-2 text-[13.5px] font-medium text-[#5A4228] transition-colors hover:bg-[#D4A373]/20 dark:border-[#D4A373]/30 dark:bg-[#D4A373]/12 dark:text-[#ECC8A1] dark:hover:bg-[#D4A373]/20"
                  >
                    Use OpenRouter Real-Time
                  </button>
                )}
              </div>

              {/* Curated Live Intelligence Starters */}
              <div className="mt-8 w-full max-w-xl text-left">
                <div className="mb-2.5 flex items-center justify-between px-1 text-xs text-[#78746B] dark:text-[#8E8A80]">
                  <span>Real-time live briefings</span>
                  <span className="tabular-nums">
                    {activeModel?.provider === 'openrouter'
                      ? `OpenRouter · ${activeModel.name}`
                      : `Live Web · ${activeModel?.name || 'Nova AI'}`}
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {LIVE_BRIEFING_STARTERS.map((item) => (
                    <button
                      key={item.title}
                      type="button"
                      onClick={() => onSendMessage(item.prompt, [], true)}
                      className="group flex flex-col justify-between rounded-2xl border border-[#E6E1D6] bg-white/75 p-4 text-left transition-all hover:border-[#D2CBBF] hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#181715]/20 active:scale-[0.99] dark:border-[#26241F] dark:bg-[#171613]/85 dark:hover:border-[#38352E] dark:hover:bg-[#1C1B17]"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[14px] font-semibold text-[#181715] dark:text-[#F2EFE9]">
                          {item.title}
                        </span>
                        <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-[#9B968B] transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-[#181715] dark:text-[#78746B] dark:group-hover:text-[#ECC8A1]" />
                      </div>
                      <p className="mt-1 line-clamp-1 text-xs text-[#6F6B62] dark:text-[#98948A]">
                        {item.subtitle}
                      </p>
                    </button>
                  ))}
                </div>

                {/* Unboxed Live Market & World Reference Lines */}
                {livePulse && (livePulse.btcUsd || livePulse.ethUsd || livePulse.headlines.length > 0) && (
                  <div className="mt-4 space-y-1 px-2 text-center text-xs text-[#78746B] dark:text-[#8E8A80] tabular-nums">
                    {(livePulse.btcUsd || livePulse.ethUsd) && (
                      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5">
                        <span>Live market desk</span>
                        {livePulse.btcUsd && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>BTC {livePulse.btcUsd}</span>
                          </>
                        )}
                        {livePulse.ethUsd && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>ETH {livePulse.ethUsd}</span>
                          </>
                        )}
                      </div>
                    )}
                    {livePulse.headlines[0] && (
                      <div className="flex items-center justify-center">
                        <button
                          type="button"
                          onClick={() =>
                            onSendMessage(
                              `Tell me the latest live details about: "${livePulse.headlines[0].title}"`,
                              [],
                              true
                            )
                          }
                          className="max-w-[300px] truncate text-[#6F6B62] underline decoration-[#78746B]/35 underline-offset-2 transition-colors hover:text-[#181715] sm:max-w-[440px] dark:text-[#98948A] dark:hover:text-[#F2EFE9]"
                        >
                          {livePulse.headlines[0].publisher}: {livePulse.headlines[0].title}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-7 pt-5 pb-6">
              {conversation.messages.map((msg, idx) => {
                if (msg.role === 'user') {
                  return (
                    <div key={msg.id} className="flex flex-col items-end">
                      {msg.attachments && msg.attachments.length > 0 && (
                        <div className="mb-2 flex max-w-[88%] flex-wrap justify-end gap-2">
                          {msg.attachments.map((att) =>
                            att.kind === 'image' && att.dataUrl ? (
                              <img
                                key={att.id}
                                src={att.dataUrl}
                                alt={att.name}
                                referrerPolicy="no-referrer"
                                className="max-h-48 max-w-[220px] rounded-2xl border border-[#E5E0D5] object-cover dark:border-[#282621]"
                              />
                            ) : (
                              <div
                                key={att.id}
                                className="flex items-center gap-2 rounded-2xl border border-[#E5E0D5] bg-white px-3 py-2 text-xs text-[#3A3935] dark:border-[#282621] dark:bg-[#1B1A17] dark:text-[#D1CEC5]"
                              >
                                <FileText className="h-4 w-4 shrink-0 text-[#5C5952] dark:text-[#A3A096]" />
                                <span className="max-w-[160px] truncate font-medium">{att.name}</span>
                                <span className="text-[#8A877E] tabular-nums">
                                  · {formatBytes(att.sizeBytes)}
                                </span>
                              </div>
                            )
                          )}
                        </div>
                      )}

                      {msg.content && (
                        <div className="max-w-[88%] rounded-[22px] rounded-br-md border border-[#E6E1D6]/70 bg-[#EFECE4] px-4 py-3 text-[15.5px] leading-relaxed text-[#181715] sm:max-w-[78%] dark:border-[#2B2923] dark:bg-[#21201C] dark:text-[#F2EFE9]">
                          <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                        </div>
                      )}
                    </div>
                  );
                }

                // Assistant Message
                const isLastAssistant = idx === lastAssistantIdx;
                const isCurrentlyGeneratingThis = isStreaming && isLastAssistant;
                const isOpenRouterKeyError =
                  msg.errorCode === 'MISSING_OPENROUTER_KEY' ||
                  msg.errorCode === 'OPENROUTER_UNAUTHORIZED' ||
                  msg.errorCode === 'INVALID_OPENROUTER_KEY';

                return (
                  <article key={msg.id} className="min-w-0">
                    {/* Clean unboxed metadata header */}
                    <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs text-[#78746B] dark:text-[#8E8A80] tabular-nums">
                      <span className="font-semibold text-[#181715] dark:text-[#F2EFE9]">
                        {resolveModelLabel(msg.modelId)}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{formatTime(msg.createdAt)}</span>
                      <span aria-hidden="true">·</span>
                      <span>{msg.usedRealtimeData ? 'Live Grounded' : 'Free'}</span>
                      {msg.stopped && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>Stopped</span>
                        </>
                      )}
                    </div>

                    {msg.isError ? (
                      <div
                        role="alert"
                        className="rounded-2xl border border-red-200 bg-red-50/90 p-4 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/35 dark:text-red-200"
                      >
                        <div className="flex items-start gap-2.5">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
                          <div className="flex-1 space-y-3">
                            <p className="leading-relaxed">{msg.content}</p>
                            <div className="flex flex-wrap items-center gap-2">
                              {isOpenRouterKeyError && (
                                <button
                                  type="button"
                                  onClick={onOpenKeySettings}
                                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full bg-[#181715] px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#2B2A27] dark:bg-[#F2EFE9] dark:text-[#181715] whitespace-nowrap shrink-0"
                                >
                                  <KeyRound className="h-3.5 w-3.5" />
                                  <span>Enter OpenRouter Key</span>
                                </button>
                              )}
                              {isLastAssistant && !isStreaming && (
                                <button
                                  type="button"
                                  onClick={onRegenerateLast}
                                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full bg-red-600 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-500 whitespace-nowrap shrink-0"
                                >
                                  <RotateCcw className="h-3.5 w-3.5" />
                                  <span>Retry</span>
                                </button>
                              )}
                              {conversation.modelId !== DEFAULT_GEMINI_MODEL_ID && (
                                <button
                                  type="button"
                                  onClick={onQuickSelectGeminiFlash}
                                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-red-300 bg-white px-3.5 py-1.5 text-xs font-medium text-[#181715] transition-colors hover:bg-[#F8F6F0] dark:border-red-800/60 dark:bg-[#201F1C] dark:text-[#F2EFE9] whitespace-nowrap shrink-0"
                                >
                                  <span>Switch to Gemini 3.1 Flash Lite</span>
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : !msg.content && isCurrentlyGeneratingThis ? (
                      <div className="space-y-2.5 py-2" aria-label="Generating response">
                        <div className="flex items-center gap-2 text-xs text-[#6F6B62] dark:text-[#A39E93]">
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-[#9A7B56] dark:text-[#D4A373]" />
                          <span>{msg.statusText || 'Composing response…'}</span>
                        </div>
                        <div className="h-3 w-52 animate-pulse rounded-md bg-[#E6E1D6] dark:bg-[#26241F]" />
                        <div className="h-3 w-72 animate-pulse rounded-md bg-[#EFECE4] dark:bg-[#1E1D19]" />
                      </div>
                    ) : (
                      <>
                        <MarkdownRenderer content={msg.content} />

                        {/* Live Grounded Source Citations */}
                        {msg.sources && msg.sources.length > 0 && (
                          <div className="mt-4 border-t border-[#E6E1D6] pt-3 dark:border-[#26241F]">
                            <div className="mb-2 text-[11px] font-medium text-[#78746B] dark:text-[#8E8A80]">
                              Live sources referenced
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {msg.sources.map((src, sIdx) => (
                                <a
                                  key={`${src.url}-${sIdx}`}
                                  href={src.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex max-w-full items-center gap-1.5 rounded-xl border border-[#E5E0D5] bg-white/80 px-3 py-1.5 text-xs text-[#3A3833] transition-colors hover:border-[#C9C2B4] hover:bg-white dark:border-[#282621] dark:bg-[#191815] dark:text-[#D5D1C8] dark:hover:border-[#3B3830] dark:hover:bg-[#211F1B]"
                                >
                                  <span className="font-semibold text-[#181715] dark:text-[#ECC8A1] shrink-0">
                                    {src.publisher}
                                  </span>
                                  <span aria-hidden="true" className="text-[#9B968B]">
                                    ·
                                  </span>
                                  <span className="max-w-[190px] truncate sm:max-w-[240px]">
                                    {src.title}
                                  </span>
                                  <ArrowUpRight className="h-3 w-3 shrink-0 text-[#8E8A80]" />
                                </a>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    {/* Assistant Action Bar */}
                    {!msg.isError && msg.content && !isCurrentlyGeneratingThis && (
                      <div className="mt-2.5 flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => void handleCopyMessage(msg)}
                          aria-label="Copy assistant response"
                          className="inline-flex min-h-[34px] items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-[#6F6B62] transition-colors hover:bg-[#ECE8DF] hover:text-[#181715] dark:text-[#98948A] dark:hover:bg-[#22201C] dark:hover:text-[#F2EFE9] whitespace-nowrap shrink-0"
                        >
                          {copiedMsgId === msg.id ? (
                            <>
                              <Check className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400" />
                              <span>Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-3.5 w-3.5" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>

                        {isLastAssistant && (
                          <button
                            type="button"
                            onClick={onRegenerateLast}
                            aria-label="Regenerate response"
                            className="inline-flex min-h-[34px] items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-[#6F6B62] transition-colors hover:bg-[#ECE8DF] hover:text-[#181715] dark:text-[#98948A] dark:hover:bg-[#22201C] dark:hover:text-[#F2EFE9] whitespace-nowrap shrink-0"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            <span>Regenerate</span>
                          </button>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
              <div ref={bottomAnchorRef} />
            </div>
          )}
        </div>
      </div>

      {/* Bottom Floating Luxury Message Composer */}
      <div className="shrink-0 bg-transparent px-3.5 pt-2 pb-4 sm:px-6 sm:pb-6">
        <div className="mx-auto max-w-2xl space-y-2 lg:max-w-3xl">
          {/* Direct OpenRouter Key Prompt when an OpenRouter model is active without a key */}
          {needsOpenRouterKeyBanner && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#E5E0D5] bg-[#F2EFE8] px-4 py-2.5 text-xs text-[#181715] dark:border-[#282621] dark:bg-[#191815] dark:text-[#F2EFE9]">
              <div className="flex items-center gap-2">
                <KeyRound className="h-3.5 w-3.5 shrink-0 text-[#6F6B62] dark:text-[#D4A373]" />
                <span>
                  Connect your OpenRouter API key to run real-time data with{' '}
                  <strong>{activeModel?.name}</strong>.
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onOpenKeySettings}
                  className="rounded-full bg-[#181715] px-3 py-1 font-semibold text-white hover:bg-[#2C2A26] dark:bg-[#F2EFE9] dark:text-[#181715] whitespace-nowrap shrink-0"
                >
                  Enter key
                </button>
                <button
                  type="button"
                  onClick={onQuickSelectGeminiFlash}
                  className="rounded-full px-2.5 py-1 font-medium text-[#5C5952] hover:bg-[#E5E0D5] dark:text-[#B5B2A8] dark:hover:bg-[#26241F] whitespace-nowrap shrink-0"
                >
                  Use Gemini 3.1 Flash Lite
                </button>
              </div>
            </div>
          )}

          {/* Voice Dictation Notice */}
          {voiceNotice && (
            <div className="flex items-center justify-between gap-2 rounded-2xl border border-[#E5E0D5] bg-[#F2EFE8] px-4 py-2 text-xs text-[#5C5952] dark:border-[#282621] dark:bg-[#191815] dark:text-[#B5B2A8]">
              <span>{voiceNotice}</span>
              <button
                type="button"
                onClick={() => setVoiceNotice(null)}
                aria-label="Dismiss voice notice"
                className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-[#E5E0D5] dark:hover:bg-[#26241F]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Upload or Capability Warnings */}
          {(uploadError || !capabilityCheck.valid) && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
            >
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <span>{uploadError || capabilityCheck.reason}</span>
              </div>
              {!capabilityCheck.valid &&
                conversation.modelId !== DEFAULT_GEMINI_MODEL_ID &&
                attachments.every((a) => a.kind !== 'image') && (
                  <button
                    type="button"
                    onClick={onQuickSelectGeminiFlash}
                    className="rounded-full bg-amber-900/10 px-3 py-1 font-semibold text-amber-950 hover:bg-amber-900/20 dark:bg-amber-400/20 dark:text-amber-100 whitespace-nowrap shrink-0"
                  >
                    Use Gemini 3.1 Flash Lite
                  </button>
                )}
            </div>
          )}

          {/* Attached Files Preview */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-1 pt-1">
              {attachments.map((att) => {
                const isIncompatible = capabilityCheck.incompatibleAttachmentIds.includes(att.id);
                return (
                  <div
                    key={att.id}
                    className={`flex items-center gap-2 rounded-2xl border px-3 py-1.5 text-xs ${
                      isIncompatible
                        ? 'border-amber-400 bg-amber-50/80 dark:border-amber-500/60 dark:bg-amber-950/30'
                        : 'border-[#E5E0D5] bg-white dark:border-[#282621] dark:bg-[#191815]'
                    }`}
                  >
                    {att.kind === 'image' && att.dataUrl ? (
                      <img
                        src={att.dataUrl}
                        alt={att.name}
                        referrerPolicy="no-referrer"
                        className="h-8 w-8 shrink-0 rounded-lg object-cover"
                      />
                    ) : (
                      <FileText className="h-4 w-4 shrink-0 text-[#5C5952] dark:text-[#B5B2A8]" />
                    )}
                    <div className="min-w-0">
                      <div className="max-w-[140px] truncate font-medium text-[#181715] dark:text-[#F2EFE9]">
                        {att.name}
                      </div>
                      <div className="text-[10px] text-[#8A877E] tabular-nums">
                        {formatBytes(att.sizeBytes)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setAttachments((prev) => prev.filter((item) => item.id !== att.id))
                      }
                      aria-label={`Remove attachment ${att.name}`}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[#8A877E] hover:bg-[#ECE8DF] hover:text-[#181715] dark:hover:bg-[#26241F] dark:hover:text-[#F2EFE9]"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <form
            onSubmit={handleSubmit}
            className="rounded-[28px] border border-[#E3DED2] bg-white/95 px-3.5 pt-3.5 pb-3 shadow-[0_10px_36px_-8px_rgba(24,23,21,0.08)] transition-colors focus-within:border-[#C8C1B2] sm:px-4 sm:pt-4 dark:border-[#282621] dark:bg-[#181714]/95 dark:shadow-[0_14px_40px_-8px_rgba(0,0,0,0.55)] dark:focus-within:border-[#3D3A32]"
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.txt,.md,.markdown,.csv,.json,.ts,.tsx,.js,.jsx,.py,.html,.css,.sql,.yaml,.yml,.xml,.log"
              onChange={(e) => void handleFilesSelected(e.target.files)}
              className="hidden"
            />

            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder={
                realtimeEnabled
                  ? 'Ask anything with live real-time data…'
                  : 'Message Nova…'
              }
              aria-label="Message prompt"
              className="max-h-44 w-full resize-none bg-transparent px-1.5 py-0.5 text-[16.5px] leading-relaxed text-[#181715] placeholder:text-[#8E8A80] focus:outline-none dark:text-[#F2EFE9] dark:placeholder:text-[#757168]"
            />

            <div className="mt-3 flex items-center justify-between gap-2">
              {/* Left Toolbar: + Attachment, Model Selector, and Live Real-Time Toggle */}
              <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Attach documents or code files"
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#EFECE4] text-[#181715] transition-colors hover:bg-[#E4E0D6] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#181715]/20 active:scale-95 sm:h-11 sm:w-11 dark:bg-[#25231E] dark:text-[#F2EFE9] dark:hover:bg-[#2F2D27] dark:focus-visible:ring-[#F2EFE9]/25"
                >
                  <Plus className="h-5 w-5 stroke-[1.8]" />
                </button>

                <button
                  type="button"
                  onClick={onOpenModelSelector}
                  aria-label="Switch free AI model"
                  className="inline-flex h-10 min-w-0 max-w-[116px] items-center justify-center rounded-full bg-[#EFECE4] px-3 text-[13.5px] font-medium text-[#181715] transition-colors hover:bg-[#E4E0D6] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#181715]/20 active:scale-[0.99] sm:h-11 sm:max-w-[220px] sm:px-4 sm:text-[14px] dark:bg-[#25231E] dark:text-[#F2EFE9] dark:hover:bg-[#2F2D27] dark:focus-visible:ring-[#F2EFE9]/25"
                >
                  <span className="truncate">
                    {activeModel?.name || conversation.modelId}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={onToggleRealtime}
                  aria-pressed={realtimeEnabled}
                  aria-label={
                    realtimeEnabled
                      ? 'Disable live real-time web data'
                      : 'Enable live real-time web data'
                  }
                  title={
                    realtimeEnabled
                      ? 'Live real-time data enabled — click to disable'
                      : 'Enable live real-time data'
                  }
                  className={`inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#181715]/20 active:scale-[0.99] sm:h-11 sm:px-3.5 ${
                    realtimeEnabled
                      ? 'bg-[#181715] text-[#F8F6F0] dark:border dark:border-[#D4A373]/40 dark:bg-[#D4A373]/18 dark:text-[#ECC8A1]'
                      : 'bg-[#EFECE4] text-[#6F6B62] hover:bg-[#E4E0D6] hover:text-[#181715] dark:bg-[#25231E] dark:text-[#98948A] dark:hover:bg-[#2F2D27] dark:hover:text-[#F2EFE9]'
                  }`}
                >
                  <Globe className="h-3.5 w-3.5 shrink-0" />
                  <span>Live</span>
                </button>
              </div>

              {/* Right Toolbar: Mic Dictation & Primary Action Circle */}
              <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
                <button
                  type="button"
                  onClick={toggleVoiceDictation}
                  aria-label={isListening ? 'Stop voice dictation' : 'Start voice dictation'}
                  aria-pressed={isListening}
                  className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#181715]/20 active:scale-95 sm:h-11 sm:w-11 dark:focus-visible:ring-[#F2EFE9]/25 ${
                    isListening
                      ? 'bg-[#181715] text-white ring-4 ring-[#181715]/15 dark:bg-[#F2EFE9] dark:text-[#181715]'
                      : 'bg-[#EFECE4] text-[#181715] hover:bg-[#E4E0D6] dark:bg-[#25231E] dark:text-[#F2EFE9] dark:hover:bg-[#2F2D27]'
                  }`}
                >
                  <Mic className="h-[18px] w-[18px] stroke-[1.8]" />
                </button>

                {isStreaming ? (
                  <button
                    type="button"
                    onClick={onStopStreaming}
                    aria-label="Stop generating"
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#181715] text-white transition-all hover:bg-[#2C2A26] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#181715]/25 active:scale-95 sm:h-11 sm:w-11 dark:bg-[#F2EFE9] dark:text-[#181715] dark:hover:bg-[#E3E0D8]"
                  >
                    <Square className="h-3.5 w-3.5 fill-current" />
                  </button>
                ) : hasPromptReady ? (
                  <button
                    type="submit"
                    disabled={!capabilityCheck.valid}
                    aria-label="Send message"
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#181715] text-white transition-all hover:bg-[#2C2A26] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#181715]/25 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 sm:h-11 sm:w-11 dark:bg-[#F2EFE9] dark:text-[#181715] dark:hover:bg-[#E3E0D8]"
                  >
                    <ArrowUp className="h-5 w-5 stroke-[2.1]" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      if (isListening && recognitionRef.current) {
                        recognitionRef.current.stop();
                        setIsListening(false);
                      }
                      onOpenLiveVoice();
                    }}
                    aria-label="Start live voice conversation"
                    title="Start live voice conversation"
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#181715] text-white transition-all hover:bg-[#2C2A26] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#181715]/25 active:scale-95 sm:h-11 sm:w-11 dark:bg-[#F2EFE9] dark:text-[#181715] dark:hover:bg-[#E3E0D8]"
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
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
                )}
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
