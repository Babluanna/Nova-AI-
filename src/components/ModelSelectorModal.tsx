import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Loader2,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import type { ModelInfo, ProviderStatus } from '../types/nova.ts';
import { formatContextWindow } from '../utils/modelCapabilities.ts';

interface ModelSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedModelId: string;
  onSelectModel: (model: ModelInfo) => void;
  geminiModels: ModelInfo[];
  openRouterModels: ModelInfo[];
  openRouterError?: string;
  providerStatus: ProviderStatus;
  hasUserOpenRouterKey: boolean;
  maskedUserKey: string;
  onSaveQuickOpenRouterKey: (rawKey: string) => Promise<{ ok: boolean; error?: string }>;
  onOpenFullKeySettings: () => void;
  isRefreshing: boolean;
  onRefreshModels: () => void;
}

type CatalogFilter = 'all' | 'gemini' | 'openrouter';

export const ModelSelectorModal: React.FC<ModelSelectorModalProps> = ({
  isOpen,
  onClose,
  selectedModelId,
  onSelectModel,
  geminiModels,
  openRouterModels,
  openRouterError,
  providerStatus,
  hasUserOpenRouterKey,
  maskedUserKey,
  onSaveQuickOpenRouterKey,
  onOpenFullKeySettings,
  isRefreshing,
  onRefreshModels,
}) => {
  const [search, setSearch] = useState('');
  const [filterTab, setFilterTab] = useState<CatalogFilter>('all');
  const [quickKeyInput, setQuickKeyInput] = useState('');
  const [isSavingQuickKey, setIsSavingQuickKey] = useState(false);
  const [quickKeyFeedback, setQuickKeyFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [expandInlineKey, setExpandInlineKey] = useState(false);

  const openRouterReady = providerStatus.openRouterConfigured || hasUserOpenRouterKey;

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const filteredGemini = useMemo(() => {
    if (filterTab === 'openrouter') return [];
    const q = search.trim().toLowerCase();
    return geminiModels.filter((m) => {
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q) ||
        (m.vendor || '').toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q)
      );
    });
  }, [geminiModels, search, filterTab]);

  const filteredOpenRouter = useMemo(() => {
    if (filterTab === 'gemini') return [];
    const q = search.trim().toLowerCase();
    return openRouterModels.filter((m) => {
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q) ||
        (m.vendor || '').toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q)
      );
    });
  }, [openRouterModels, search, filterTab]);

  if (!isOpen) return null;

  const renderMetadataLine = (model: ModelInfo) => {
    const items: string[] = [];
    if (model.vendor) items.push(model.vendor);
    const ctx = formatContextWindow(model.contextLength);
    if (ctx) items.push(ctx);
    items.push('Live Data');
    if (model.supportsDocuments) items.push('Documents');
    items.push('Free');
    return items.join(' · ');
  };

  const handleQuickKeySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickKeyInput.trim() || isSavingQuickKey) return;
    setIsSavingQuickKey(true);
    setQuickKeyFeedback(null);
    try {
      const result = await onSaveQuickOpenRouterKey(quickKeyInput);
      if (result.ok) {
        setQuickKeyInput('');
        setQuickKeyFeedback({
          type: 'success',
          text: 'OpenRouter key verified and connected.',
        });
      } else {
        setQuickKeyFeedback({
          type: 'error',
          text: result.error || 'Could not verify API key.',
        });
      }
    } finally {
      setIsSavingQuickKey(false);
    }
  };

  const totalFreeCount = geminiModels.length + openRouterModels.length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-0 backdrop-blur-xs sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="model-selector-title"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border border-[#E5E2DA] bg-[#FAF9F5] shadow-2xl dark:border-[#2E2D28] dark:bg-[#191815] sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mobile grab handle */}
        <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-[#D6D3C9] dark:bg-[#3A3933] sm:hidden" />

        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#E5E2DA] px-5 py-4 dark:border-[#2B2A26]">
          <div>
            <h2
              id="model-selector-title"
              className="font-serif-editorial text-xl font-medium tracking-tight text-[#141413] dark:text-[#F5F4EF]"
            >
              Free AI Models
            </h2>
            <p className="mt-0.5 text-xs text-[#6B6860] dark:text-[#9E9B92] tabular-nums">
              {totalFreeCount} free models with real-time live data · {openRouterModels.length} OpenRouter · {geminiModels.length} Gemini
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRefreshModels}
              disabled={isRefreshing}
              aria-label="Refresh free model catalog"
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-[#EFECE6] px-3.5 py-2 text-xs font-medium text-[#141413] transition-colors hover:bg-[#E4E0D8] disabled:opacity-50 dark:bg-[#2B2A26] dark:text-[#F5F4EF] dark:hover:bg-[#35342F] whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>Sync list</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close model selector"
              className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-full text-[#6B6860] transition-colors hover:bg-[#EFECE6] hover:text-[#141413] dark:text-[#9E9B92] dark:hover:bg-[#2B2A26] dark:hover:text-[#F5F4EF]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Search & Provider/Capability Segmented Filter */}
        <div className="flex flex-col gap-3 border-b border-[#E5E2DA] bg-[#F4F2EC] px-5 py-3.5 dark:border-[#2B2A26] dark:bg-[#1E1D1A] sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-[#8A877E]" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search free Gemini, Nemotron, Poolside, LiquidAI…"
              aria-label="Search free models"
              className="w-full min-h-[40px] rounded-2xl border border-[#E2DFD7] bg-white py-2 pr-3 pl-9 text-sm text-[#141413] placeholder:text-[#8A877E] focus:border-[#141413]/45 focus:outline-none dark:border-[#2E2D28] dark:bg-[#141413] dark:text-[#F5F4EF]"
            />
          </div>

          <div
            className="flex items-center gap-1 rounded-2xl bg-[#E6E2D9] p-1 dark:bg-[#2A2924] shrink-0"
            role="group"
            aria-label="Filter free models"
          >
            {(
              [
                { id: 'all', label: 'All Free' },
                { id: 'gemini', label: 'Gemini' },
                { id: 'openrouter', label: 'OpenRouter' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilterTab(tab.id)}
                className={`min-h-[32px] rounded-xl px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  filterTab === tab.id
                    ? 'bg-white text-[#141413] shadow-2xs dark:bg-[#191815] dark:text-[#F5F4EF]'
                    : 'text-[#5C5952] hover:text-[#141413] dark:text-[#9E9B92] dark:hover:text-[#F5F4EF]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Model Groups */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          {/* Group 1: Google Gemini Free Tier */}
          {filterTab !== 'openrouter' && (
            <section aria-labelledby="group-gemini-heading">
              <div className="mb-2.5 flex items-center justify-between gap-2">
                <h3
                  id="group-gemini-heading"
                  className="text-xs font-semibold tracking-tight text-[#141413] dark:text-[#F5F4EF]"
                >
                  Google Gemini · Free Tier
                </h3>
                <span className="text-xs text-[#6B6860] dark:text-[#9E9B92]">
                  {providerStatus.geminiConfigured
                    ? 'Ready · No extra key needed'
                    : 'Server key missing'}
                </span>
              </div>

              {filteredGemini.length === 0 ? (
                <p className="py-3 text-xs text-[#6B6860] dark:text-[#9E9B92]">
                  No free Gemini models match your search.
                </p>
              ) : (
                <div className="divide-y divide-[#E8E5DD] overflow-hidden rounded-2xl border border-[#E5E2DA] bg-white dark:divide-[#2B2A26] dark:border-[#2E2D28] dark:bg-[#201F1C]">
                  {filteredGemini.map((model) => {
                    const selected = model.id === selectedModelId;
                    return (
                      <button
                        key={model.id}
                        type="button"
                        onClick={() => {
                          onSelectModel(model);
                          onClose();
                        }}
                        className={`flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition-colors ${
                          selected
                            ? 'bg-[#F3F0E8] dark:bg-[#2C2B26]'
                            : 'hover:bg-[#FAF8F3] dark:hover:bg-[#262521]'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-semibold text-[#141413] dark:text-[#F5F4EF]">
                              {model.name}
                            </span>
                            <span className="truncate font-mono text-[11px] text-[#8A877E] dark:text-[#8A877E]">
                              {model.id}
                            </span>
                          </div>
                          <p className="mt-0.5 line-clamp-1 text-xs text-[#5C5952] dark:text-[#B5B2A8]">
                            {model.description}
                          </p>
                          <p className="mt-1 text-[11px] text-[#7A776E] dark:text-[#8A877E] tabular-nums">
                            {renderMetadataLine(model)}
                          </p>
                        </div>
                        <div className="mt-1 shrink-0">
                          {selected && (
                            <Check className="h-4 w-4 text-[#141413] dark:text-[#F5F4EF]" />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* Group 2: OpenRouter Free Models (Complete Live Free Catalog) */}
          {filterTab !== 'gemini' && (
            <section aria-labelledby="group-openrouter-heading">
              <div className="mb-2.5 flex items-center justify-between gap-2">
                <h3
                  id="group-openrouter-heading"
                  className="text-xs font-semibold tracking-tight text-[#141413] dark:text-[#F5F4EF] tabular-nums"
                >
                  OpenRouter · All Free Models ({filteredOpenRouter.length})
                </h3>
                {hasUserOpenRouterKey ? (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenFullKeySettings();
                    }}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400 whitespace-nowrap shrink-0"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>Key active ({maskedUserKey}) · Manage</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      if (!openRouterReady || expandInlineKey) {
                        onClose();
                        onOpenFullKeySettings();
                      } else {
                        setExpandInlineKey(true);
                      }
                    }}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#141413] hover:underline dark:text-[#F5F4EF] whitespace-nowrap shrink-0"
                  >
                    <KeyRound className="h-3.5 w-3.5" />
                    <span>
                      {!openRouterReady || expandInlineKey
                        ? 'Full Key Settings'
                        : 'Enter Personal Key'}
                    </span>
                  </button>
                )}
              </div>

              {/* Inline Direct OpenRouter Key Input when not connected or explicitly expanded */}
              {(!openRouterReady || expandInlineKey) && !hasUserOpenRouterKey && (
                <form
                  onSubmit={(e) => void handleQuickKeySubmit(e)}
                  className="mb-3.5 rounded-2xl border border-[#E5E2DA] bg-[#F4F2EC] p-3.5 dark:border-[#2E2D28] dark:bg-[#201F1C]"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[#141413] dark:text-[#F5F4EF]">
                      Enter your OpenRouter API key directly in Nova AI
                    </span>
                    <a
                      href="https://openrouter.ai/settings/keys"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-[#5C5952] underline underline-offset-2 hover:text-[#141413] dark:text-[#B5B2A8] dark:hover:text-[#F5F4EF] whitespace-nowrap shrink-0"
                    >
                      <span>Get free key</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>

                  <div className="mt-2.5 flex flex-col gap-2 sm:flex-row">
                    <input
                      type="password"
                      value={quickKeyInput}
                      onChange={(e) => setQuickKeyInput(e.target.value)}
                      placeholder="Paste sk-or-v1-… key directly here"
                      aria-label="OpenRouter API key"
                      autoComplete="off"
                      spellCheck={false}
                      className="min-h-[38px] flex-1 rounded-xl border border-[#E2DFD7] bg-white px-3 py-1.5 font-mono text-xs text-[#141413] placeholder:font-sans placeholder:text-[#8A877E] focus:border-[#141413]/45 focus:outline-none dark:border-[#2E2D28] dark:bg-[#141413] dark:text-[#F5F4EF]"
                    />
                    <button
                      type="submit"
                      disabled={!quickKeyInput.trim() || isSavingQuickKey}
                      className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-full bg-[#141413] px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#2B2A27] disabled:opacity-45 dark:bg-[#F5F4EF] dark:text-[#141413] whitespace-nowrap shrink-0"
                    >
                      {isSavingQuickKey ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          <span>Verifying…</span>
                        </>
                      ) : (
                        <span>Verify &amp; Save</span>
                      )}
                    </button>
                  </div>

                  {quickKeyFeedback && (
                    <p
                      className={`mt-2 text-xs ${
                        quickKeyFeedback.type === 'error'
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-emerald-700 dark:text-emerald-400'
                      }`}
                    >
                      {quickKeyFeedback.text}
                    </p>
                  )}
                </form>
              )}

              {quickKeyFeedback?.type === 'success' && openRouterReady && (
                <div className="mb-3 rounded-2xl border border-emerald-200 bg-emerald-50/80 px-3.5 py-2.5 text-xs text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300">
                  {quickKeyFeedback.text}
                </div>
              )}

              {openRouterError && openRouterModels.length === 0 ? (
                <div className="rounded-2xl border border-red-200 bg-red-50/70 p-4 text-xs text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
                  Could not load free OpenRouter models: {openRouterError}
                </div>
              ) : filteredOpenRouter.length === 0 ? (
                <p className="py-3 text-xs text-[#6B6860] dark:text-[#9E9B92]">
                  No free OpenRouter models match &ldquo;{search}&rdquo;.
                </p>
              ) : (
                <div className="divide-y divide-[#E8E5DD] overflow-hidden rounded-2xl border border-[#E5E2DA] bg-white dark:divide-[#2B2A26] dark:border-[#2E2D28] dark:bg-[#201F1C]">
                  {filteredOpenRouter.map((model) => {
                    const selected = model.id === selectedModelId;
                    return (
                      <button
                        key={model.id}
                        type="button"
                        onClick={() => {
                          onSelectModel(model);
                          onClose();
                        }}
                        className={`flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition-colors ${
                          selected
                            ? 'bg-[#F3F0E8] dark:bg-[#2C2B26]'
                            : 'hover:bg-[#FAF8F3] dark:hover:bg-[#262521]'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-semibold text-[#141413] dark:text-[#F5F4EF]">
                              {model.name}
                            </span>
                            <span className="truncate font-mono text-[11px] text-[#8A877E] dark:text-[#8A877E]">
                              {model.id}
                            </span>
                          </div>
                          <p className="mt-0.5 line-clamp-1 text-xs text-[#5C5952] dark:text-[#B5B2A8]">
                            {model.description}
                          </p>
                          <p className="mt-1 text-[11px] text-[#7A776E] dark:text-[#8A877E] tabular-nums">
                            {renderMetadataLine(model)}
                          </p>
                        </div>
                        <div className="mt-1 shrink-0">
                          {selected && (
                            <Check className="h-4 w-4 text-[#141413] dark:text-[#F5F4EF]" />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
};
