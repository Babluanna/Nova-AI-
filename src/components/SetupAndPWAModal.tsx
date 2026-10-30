import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Server,
  ShieldCheck,
  Smartphone,
  Trash2,
  X,
} from 'lucide-react';
import type { OpenRouterKeyStorageMode, ProviderStatus } from '../types/nova.ts';

interface SetupAndPWAModalProps {
  isOpen: boolean;
  onClose: () => void;
  providerStatus: ProviderStatus;
  openRouterModelCount: number;
  hasUserOpenRouterKey: boolean;
  maskedUserKey: string;
  keyStorageMode: OpenRouterKeyStorageMode;
  onSaveOpenRouterKey: (
    rawKey: string,
    storageMode: OpenRouterKeyStorageMode
  ) => Promise<{ ok: boolean; message?: string; error?: string }>;
  onDisconnectOpenRouterKey: () => void;
  isInstallable: boolean;
  isInstalled: boolean;
  isIOS: boolean;
  onInstallPWA: () => Promise<boolean>;
}

export const SetupAndPWAModal: React.FC<SetupAndPWAModalProps> = ({
  isOpen,
  onClose,
  providerStatus,
  openRouterModelCount,
  hasUserOpenRouterKey,
  maskedUserKey,
  keyStorageMode,
  onSaveOpenRouterKey,
  onDisconnectOpenRouterKey,
  isInstallable,
  isInstalled,
  isIOS,
  onInstallPWA,
}) => {
  const [keyDraft, setKeyDraft] = useState('');
  const [storageChoice, setStorageChoice] = useState<OpenRouterKeyStorageMode>(keyStorageMode);
  const [showKeyText, setShowKeyText] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [showReplaceInput, setShowReplaceInput] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

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

  if (!isOpen) return null;

  const openRouterReady = hasUserOpenRouterKey || providerStatus.openRouterServerConfigured;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyDraft.trim() || isVerifying) return;
    setIsVerifying(true);
    setFeedback(null);
    try {
      const res = await onSaveOpenRouterKey(keyDraft, storageChoice);
      if (res.ok) {
        setKeyDraft('');
        setShowReplaceInput(false);
        setFeedback({
          type: 'success',
          text: res.message || 'OpenRouter API key verified and connected.',
        });
      } else {
        setFeedback({
          type: 'error',
          text: res.error || 'OpenRouter API key verification failed.',
        });
      }
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-0 backdrop-blur-xs sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="setup-pwa-title"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl border border-[#E5E2DA] bg-[#FAF9F5] shadow-2xl dark:border-[#2E2D28] dark:bg-[#191815] sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-[#D6D3C9] dark:bg-[#3A3933] sm:hidden" />

        <div className="flex items-center justify-between border-b border-[#E5E2DA] px-5 py-4 dark:border-[#2B2A26]">
          <div>
            <h2
              id="setup-pwa-title"
              className="font-serif-editorial text-xl font-medium tracking-tight text-[#141413] dark:text-[#F5F4EF]"
            >
              Free Plan &amp; OpenRouter Key
            </h2>
            <p className="mt-0.5 text-xs text-[#6B6860] dark:text-[#9E9B92]">
              Connect your OpenRouter API key, inspect free model status, or install Nova AI
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close setup dialog"
            className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-full text-[#6B6860] hover:bg-[#EFECE6] hover:text-[#141413] dark:text-[#9E9B92] dark:hover:bg-[#2B2A26] dark:hover:text-[#F5F4EF]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6 text-sm text-[#3A3935] dark:text-[#D1CEC5]">
          {/* 1. Direct In-App OpenRouter API Key Section */}
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#141413] dark:text-[#F5F4EF]">
                <KeyRound className="h-4 w-4 text-[#5C5952] dark:text-[#B5B2A8]" />
                <span>OpenRouter API Key ({openRouterModelCount} Free Models)</span>
              </div>
              <a
                href="https://openrouter.ai/settings/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-[#5C5952] underline underline-offset-2 hover:text-[#141413] dark:text-[#B5B2A8] dark:hover:text-[#F5F4EF] whitespace-nowrap shrink-0"
              >
                <span>Get free OpenRouter key</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>

            <div className="rounded-2xl border border-[#E5E2DA] bg-white p-4 dark:border-[#2E2D28] dark:bg-[#201F1C]">
              {hasUserOpenRouterKey && !showReplaceInput ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                        <CheckCircle2 className="h-4 w-4 shrink-0" />
                        <span>Connected in app</span>
                      </div>
                      <p className="mt-1 font-mono text-xs text-[#141413] dark:text-[#F5F4EF]">
                        {maskedUserKey}
                      </p>
                      <p className="mt-0.5 text-[11px] text-[#7A776E] dark:text-[#8A877E]">
                        {keyStorageMode === 'session'
                          ? 'Stored for this browser tab session only · Proxied over HTTPS'
                          : 'Saved locally on this device · Proxied over HTTPS'}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setFeedback(null);
                          setShowReplaceInput(true);
                        }}
                        className="inline-flex min-h-[36px] items-center rounded-full bg-[#EFECE6] px-3.5 py-1.5 text-xs font-medium text-[#141413] transition-colors hover:bg-[#E4E0D8] dark:bg-[#2B2A26] dark:text-[#F5F4EF] dark:hover:bg-[#35342F] whitespace-nowrap shrink-0"
                      >
                        Change key
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onDisconnectOpenRouterKey();
                          setFeedback({
                            type: 'success',
                            text: 'Removed saved OpenRouter key from this browser.',
                          });
                        }}
                        className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3.5 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-100 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300 dark:hover:bg-red-950/50 whitespace-nowrap shrink-0"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span>Disconnect</span>
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <form onSubmit={(e) => void handleSave(e)} className="space-y-3">
                  <p className="text-xs leading-relaxed text-[#5C5952] dark:text-[#B5B2A8]">
                    Paste your OpenRouter API key below to unlock streaming chat across all{' '}
                    <span className="font-semibold text-[#141413] dark:text-[#F5F4EF] tabular-nums">
                      {openRouterModelCount}
                    </span>{' '}
                    free OpenRouter models. Your key stays in your browser and is transmitted exclusively to Nova AI&apos;s server proxy.
                  </p>

                  <div className="relative">
                    <input
                      type={showKeyText ? 'text' : 'password'}
                      value={keyDraft}
                      onChange={(e) => setKeyDraft(e.target.value)}
                      placeholder="sk-or-v1-…"
                      aria-label="Enter OpenRouter API key"
                      autoComplete="off"
                      spellCheck={false}
                      className="w-full min-h-[42px] rounded-2xl border border-[#E2DFD7] bg-[#FAF9F5] py-2 pr-10 pl-3.5 font-mono text-xs text-[#141413] placeholder:font-sans placeholder:text-[#8A877E] focus:border-[#141413]/45 focus:outline-none dark:border-[#2E2D28] dark:bg-[#141413] dark:text-[#F5F4EF]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKeyText((v) => !v)}
                      aria-label={showKeyText ? 'Hide API key' : 'Show API key'}
                      className="absolute top-1/2 right-2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-[#8A877E] hover:bg-[#EFECE6] hover:text-[#141413] dark:hover:bg-[#2B2A26] dark:hover:text-[#F5F4EF]"
                    >
                      {showKeyText ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>

                  {/* Storage Persistence Choice */}
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div
                      className="inline-flex rounded-2xl bg-[#EFECE6] p-1 dark:bg-[#141413]"
                      role="group"
                      aria-label="Key persistence scope"
                    >
                      <button
                        type="button"
                        onClick={() => setStorageChoice('local')}
                        className={`min-h-[30px] rounded-xl px-2.5 py-1 text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 ${
                          storageChoice === 'local'
                            ? 'bg-white text-[#141413] shadow-2xs dark:bg-[#2A2924] dark:text-[#F5F4EF]'
                            : 'text-[#6B6860] hover:text-[#141413] dark:text-[#9E9B92] dark:hover:text-[#F5F4EF]'
                        }`}
                      >
                        Remember on device
                      </button>
                      <button
                        type="button"
                        onClick={() => setStorageChoice('session')}
                        className={`min-h-[30px] rounded-xl px-2.5 py-1 text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 ${
                          storageChoice === 'session'
                            ? 'bg-white text-[#141413] shadow-2xs dark:bg-[#2A2924] dark:text-[#F5F4EF]'
                            : 'text-[#6B6860] hover:text-[#141413] dark:text-[#9E9B92] dark:hover:text-[#F5F4EF]'
                        }`}
                      >
                        Session only
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      {showReplaceInput && (
                        <button
                          type="button"
                          onClick={() => setShowReplaceInput(false)}
                          className="min-h-[38px] rounded-full px-3 py-1.5 text-xs font-medium text-[#5C5952] hover:bg-[#EFECE6] dark:text-[#9E9B92] dark:hover:bg-[#2B2A26] whitespace-nowrap shrink-0"
                        >
                          Cancel
                        </button>
                      )}
                      <button
                        type="submit"
                        disabled={!keyDraft.trim() || isVerifying}
                        className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-full bg-[#141413] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#2B2A27] disabled:cursor-not-allowed disabled:opacity-45 dark:bg-[#F5F4EF] dark:text-[#141413] whitespace-nowrap shrink-0"
                      >
                        {isVerifying ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            <span>Verifying…</span>
                          </>
                        ) : (
                          <span>Verify &amp; Connect</span>
                        )}
                      </button>
                    </div>
                  </div>
                </form>
              )}

              {feedback && (
                <div
                  role="status"
                  className={`mt-3 rounded-2xl border px-3 py-2 text-xs ${
                    feedback.type === 'error'
                      ? 'border-red-200 bg-red-50/90 text-red-800 dark:border-red-900/50 dark:bg-red-950/35 dark:text-red-200'
                      : 'border-emerald-200 bg-emerald-50/90 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/35 dark:text-emerald-200'
                  }`}
                >
                  {feedback.text}
                </div>
              )}
            </div>
          </section>

          {/* 2. Server Provider Diagnostics (Read-Only Free Tier Status) */}
          <section className="space-y-2.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#141413] dark:text-[#F5F4EF]">
              <ShieldCheck className="h-4 w-4 text-[#5C5952] dark:text-[#B5B2A8]" />
              <span>Free-Tier Provider Status</span>
            </div>

            <div className="divide-y divide-[#E8E5DD] rounded-2xl border border-[#E5E2DA] bg-white dark:divide-[#2B2A26] dark:border-[#2E2D28] dark:bg-[#201F1C]">
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <div className="text-xs font-semibold text-[#141413] dark:text-[#F5F4EF]">
                    Google Gemini · Free Tier
                  </div>
                  <div className="mt-0.5 text-[11px] text-[#6B6860] dark:text-[#9E9B92]">
                    Gemini 3.1 Flash Lite &amp; Nova Live via secure server runtime
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-xs font-medium shrink-0">
                  {providerStatus.geminiConfigured ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
                      <span className="text-emerald-700 dark:text-emerald-400">Active</span>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                      <span className="text-amber-700 dark:text-amber-400">Missing in Secrets</span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <div className="text-xs font-semibold text-[#141413] dark:text-[#F5F4EF]">
                    OpenRouter · Free Models Catalog
                  </div>
                  <div className="mt-0.5 text-[11px] text-[#6B6860] dark:text-[#9E9B92] tabular-nums">
                    {openRouterModelCount} free models loaded · Paid models excluded
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-xs font-medium shrink-0">
                  {openRouterReady ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
                      <span className="text-emerald-700 dark:text-emerald-400">
                        {hasUserOpenRouterKey ? 'App Key' : 'Server Key'}
                      </span>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                      <span className="text-amber-700 dark:text-amber-400">Key needed</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* 3. Install as Progressive Web App */}
          <section className="space-y-2.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#141413] dark:text-[#F5F4EF]">
              <Smartphone className="h-4 w-4 text-[#5C5952] dark:text-[#B5B2A8]" />
              <span>Install Nova AI (iPhone, Android &amp; Desktop PWA)</span>
            </div>

            {isInstalled ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-xs text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300">
                Nova AI is installed and running in standalone app mode.
              </div>
            ) : isInstallable ? (
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#E5E2DA] bg-white px-4 py-3 dark:border-[#2E2D28] dark:bg-[#201F1C]">
                <span className="text-xs text-[#3A3935] dark:text-[#D1CEC5]">
                  Ready to install Nova AI directly to your home screen or desktop dock.
                </span>
                <button
                  type="button"
                  onClick={() => void onInstallPWA()}
                  className="inline-flex min-h-[38px] items-center gap-1.5 rounded-full bg-[#141413] px-4 py-2 text-xs font-semibold text-white hover:bg-[#2B2A27] dark:bg-[#F5F4EF] dark:text-[#141413] whitespace-nowrap shrink-0"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Install Now</span>
                </button>
              </div>
            ) : (
              <div className="space-y-2 rounded-2xl border border-[#E5E2DA] bg-white p-4 text-xs leading-relaxed dark:border-[#2E2D28] dark:bg-[#201F1C]">
                {isIOS ? (
                  <p>
                    <strong>iPhone / iPad (Safari):</strong> Open the app URL in Safari, tap{' '}
                    <strong>Share</strong>, then tap <strong>Add to Home Screen</strong>.
                  </p>
                ) : (
                  <>
                    <p>
                      <strong>Desktop &amp; Android (Chrome / Edge):</strong> Open the deployed App URL in a browser tab and click the{' '}
                      <strong>Install Nova AI</strong> icon in the address bar.
                    </p>
                    <p className="text-[#6B6860] dark:text-[#9E9B92]">
                      <strong>iPhone / iPad:</strong> Open in Safari &rarr; tap <strong>Share</strong> &rarr;{' '}
                      <strong>Add to Home Screen</strong>.
                    </p>
                  </>
                )}
              </div>
            )}
          </section>

          {/* 4. Deployment Reference */}
          <section className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#141413] dark:text-[#F5F4EF]">
              <Server className="h-4 w-4 text-[#5C5952] dark:text-[#B5B2A8]" />
              <span>Cloud Deployment</span>
            </div>
            <pre className="overflow-x-auto rounded-2xl border border-[#2B2A26] bg-[#181715] p-3.5 font-mono text-xs leading-relaxed text-[#F5F4EF]">
              <code>{`npm install
npm run build
NODE_ENV=production npm start`}</code>
            </pre>
          </section>
        </div>
      </div>
    </div>
  );
};
