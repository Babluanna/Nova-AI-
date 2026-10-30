import React, { useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Cpu,
  Download,
  KeyRound,
  Monitor,
  Moon,
  Pencil,
  Pin,
  Plus,
  Search,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import {
  ThemePreference,
  type Conversation,
  type ConversationFilter,
} from '../types/nova.ts';
import {
  filterAndSearchConversations,
  groupConversationsByDate,
} from '../utils/conversationStore.ts';

interface SidebarProps {
  conversations: Conversation[];
  activeConversationId: string;
  onSelectConversation: (id: string) => void;
  onNewChat: () => void;
  onRenameConversation: (id: string, title: string) => void;
  onTogglePinConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  onClearHistory: () => void;
  theme: ThemePreference;
  onChangeTheme: (theme: ThemePreference) => void;
  openRouterConnected: boolean;
  hasUserOpenRouterKey: boolean;
  onOpenModelSelector: () => void;
  onOpenSetupModal: () => void;
  isInstallable: boolean;
  isInstalled: boolean;
  onTriggerInstall: () => void;
  isOpen: boolean;
  onClose: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewChat,
  onRenameConversation,
  onTogglePinConversation,
  onDeleteConversation,
  onClearHistory,
  theme,
  onChangeTheme,
  openRouterConnected,
  hasUserOpenRouterKey,
  onOpenModelSelector,
  onOpenSetupModal,
  isInstallable,
  isInstalled,
  onTriggerInstall,
  isOpen,
  onClose,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<ConversationFilter>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);

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

  const filtered = filterAndSearchConversations(conversations, searchQuery, filter);
  const groups = groupConversationsByDate(filtered);

  const startRename = (conv: Conversation) => {
    setEditingId(conv.id);
    setEditDraft(conv.title);
  };

  const commitRename = (id: string) => {
    const trimmed = editDraft.trim();
    if (trimmed) {
      onRenameConversation(id, trimmed);
    }
    setEditingId(null);
  };

  const sidebarBody = (
    <aside
      aria-label="Conversation history and settings"
      className="flex h-full w-[296px] max-w-[86vw] flex-col border-r border-[#E5E0D5] bg-[#F2EFE8] text-[#181715] dark:border-[#282621] dark:bg-[#161512] dark:text-[#F2EFE9] select-none"
    >
      {/* Top Brand + New Chat + Close */}
      <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-3">
        <span className="font-serif-editorial text-xl font-medium tracking-tight text-[#141413] dark:text-[#F5F4EF] whitespace-nowrap">
          Nova AI
        </span>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              onNewChat();
              onClose();
            }}
            aria-label="New chat"
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-full bg-[#141413] px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#2B2A27] active:scale-[0.98] dark:bg-[#F5F4EF] dark:text-[#141413] dark:hover:bg-[#E5E2DA] whitespace-nowrap shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>New chat</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-full text-[#6B6860] transition-colors hover:bg-[#E8E5DD] hover:text-[#141413] dark:text-[#9E9B92] dark:hover:bg-[#262521] dark:hover:text-[#F5F4EF]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Search & Filter Conversations */}
      <div className="space-y-2.5 px-4 pb-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 h-3.5 w-3.5 -translate-y-1/2 text-[#8A877E]" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search conversations…"
            aria-label="Search conversations"
            className="w-full min-h-[38px] rounded-2xl border border-[#E2DFD7] bg-white py-1.5 pr-3 pl-9 text-xs text-[#141413] placeholder:text-[#8A877E] focus:border-[#141413]/40 focus:outline-none dark:border-[#2E2D28] dark:bg-[#21201C] dark:text-[#F5F4EF]"
          />
        </div>

        <div
          className="grid grid-cols-4 gap-0.5 rounded-xl bg-[#E8E5DD] p-0.5 dark:bg-[#23221E]"
          role="group"
          aria-label="Filter conversations"
        >
          {(
            [
              { id: 'all', label: 'All' },
              { id: 'pinned', label: 'Pinned' },
              { id: 'gemini', label: 'Gemini' },
              { id: 'openrouter', label: 'Router' },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`min-h-[30px] rounded-lg px-1.5 py-1 text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 ${
                filter === f.id
                  ? 'bg-white text-[#141413] shadow-2xs dark:bg-[#302F2A] dark:text-[#F5F4EF]'
                  : 'text-[#6B6860] hover:text-[#141413] dark:text-[#9E9B92] dark:hover:text-[#F5F4EF]'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-4">
        {groups.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <p className="text-xs font-medium text-[#5C5952] dark:text-[#9E9B92]">
              {searchQuery || filter !== 'all'
                ? 'No matching conversations'
                : 'No saved conversations yet'}
            </p>
            <p className="mt-1 text-[11px] text-[#8A877E] dark:text-[#78756D]">
              {searchQuery || filter !== 'all'
                ? 'Try clearing your search or filter.'
                : 'Send a prompt to start your history.'}
            </p>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.label}>
              <h3 className="px-2.5 pb-1.5 text-[11px] font-medium tracking-tight text-[#7A776E] dark:text-[#8A877E]">
                {group.label}
              </h3>
              <ul className="space-y-0.5">
                {group.items.map((conv) => {
                  const isActive = conv.id === activeConversationId;
                  const isEditing = editingId === conv.id;

                  return (
                    <li key={conv.id}>
                      {isEditing ? (
                        <div className="flex items-center gap-1 rounded-2xl border border-[#141413]/40 bg-white px-2.5 py-1.5 dark:border-[#F5F4EF]/40 dark:bg-[#23221E]">
                          <input
                            type="text"
                            value={editDraft}
                            onChange={(e) => setEditDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitRename(conv.id);
                              if (e.key === 'Escape') setEditingId(null);
                            }}
                            aria-label={`Edit title for ${conv.title}`}
                            autoFocus
                            className="min-w-0 flex-1 bg-transparent text-xs font-medium text-[#141413] focus:outline-none dark:text-[#F5F4EF]"
                          />
                          <button
                            type="button"
                            onClick={() => commitRename(conv.id)}
                            aria-label="Save conversation title"
                            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-[#2F2E29]"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            aria-label="Cancel rename"
                            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[#7A776E] hover:bg-[#EFECE6] dark:hover:bg-[#2F2E29]"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div
                          className={`group flex items-center justify-between gap-1 rounded-2xl px-3 py-2 transition-colors ${
                            isActive
                              ? 'bg-[#E6E2D9] text-[#141413] dark:bg-[#2A2924] dark:text-[#F5F4EF]'
                              : 'text-[#3A3935] hover:bg-[#EBE8E0] dark:text-[#D1CEC5] dark:hover:bg-[#23221E]'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              onSelectConversation(conv.id);
                              onClose();
                            }}
                            className="min-w-0 flex-1 text-left focus:outline-none"
                          >
                            <div className="truncate text-[13px] font-medium">{conv.title}</div>
                            <div className="mt-0.5 truncate text-[11px] text-[#7A776E] dark:text-[#8A877E] tabular-nums">
                              {conv.provider === 'gemini' ? 'Gemini' : 'OpenRouter'} ·{' '}
                              {conv.messages.length}{' '}
                              {conv.messages.length === 1 ? 'msg' : 'msgs'}
                            </div>
                          </button>

                          <div
                            className={`flex items-center gap-0.5 shrink-0 ${
                              isActive
                                ? 'opacity-100'
                                : 'opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:focus-within:opacity-100'
                            } transition-opacity`}
                          >
                            <button
                              type="button"
                              onClick={() => onTogglePinConversation(conv.id)}
                              aria-label={`${conv.pinned ? 'Unpin' : 'Pin'} "${conv.title}"`}
                              className={`inline-flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
                                conv.pinned
                                  ? 'text-[#141413] dark:text-[#F5F4EF]'
                                  : 'text-[#8A877E] hover:bg-[#DEDAD0] hover:text-[#141413] dark:hover:bg-[#32312B] dark:hover:text-[#F5F4EF]'
                              }`}
                            >
                              <Pin className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => startRename(conv)}
                              aria-label={`Rename "${conv.title}"`}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[#8A877E] transition-colors hover:bg-[#DEDAD0] hover:text-[#141413] dark:hover:bg-[#32312B] dark:hover:text-[#F5F4EF]"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onDeleteConversation(conv.id)}
                              aria-label={`Delete "${conv.title}"`}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[#8A877E] transition-colors hover:bg-red-100 hover:text-red-700 dark:hover:bg-red-950/50 dark:hover:text-red-400"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </div>

      {/* Bottom Dock: Free Models, OpenRouter Key, Clear History, Install & Theme */}
      <div className="space-y-2 border-t border-[#E6E3DC] p-3.5 dark:border-[#2B2A26]">
        {conversations.some((c) => c.messages.length > 0 || conversations.length > 1) && (
          <div>
            {confirmClear ? (
              <div className="flex items-center justify-between gap-2 rounded-2xl border border-red-200 bg-red-50/90 px-3 py-2 dark:border-red-900/50 dark:bg-red-950/30">
                <span className="text-xs font-medium text-red-800 dark:text-red-300">
                  Clear all chats?
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      onClearHistory();
                      setConfirmClear(false);
                    }}
                    className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-500 whitespace-nowrap shrink-0"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClear(false)}
                    className="rounded-lg px-2 py-1 text-xs font-medium text-[#5C5952] hover:bg-[#E5E1D8] dark:text-[#C7C4BA] dark:hover:bg-[#2F2E29] whitespace-nowrap shrink-0"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                className="flex w-full min-h-[36px] items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-medium text-[#5C5952] transition-colors hover:bg-[#E8E5DD] hover:text-red-700 dark:text-[#9E9B92] dark:hover:bg-[#252420] dark:hover:text-red-400 whitespace-nowrap"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Clear history</span>
              </button>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            onClose();
            onOpenModelSelector();
          }}
          className="flex w-full min-h-[40px] items-center justify-between gap-2 rounded-2xl border border-[#E2DFD7] bg-white px-3.5 py-2 text-xs font-medium text-[#141413] transition-colors hover:bg-[#FAF9F5] dark:border-[#2E2D28] dark:bg-[#21201C] dark:text-[#F5F4EF] dark:hover:bg-[#282722]"
        >
          <span className="flex items-center gap-2 truncate">
            <Cpu className="h-3.5 w-3.5 text-[#5C5952] dark:text-[#A3A096] shrink-0" />
            <span className="truncate">Browse Free Models</span>
          </span>
          <span className="text-[11px] text-[#7A776E] dark:text-[#8A877E] whitespace-nowrap shrink-0">
            Free only
          </span>
        </button>

        {/* Dedicated OpenRouter Key & App Settings Button */}
        <button
          type="button"
          onClick={() => {
            onClose();
            onOpenSetupModal();
          }}
          className="flex w-full min-h-[40px] items-center justify-between gap-2 rounded-2xl border border-[#E2DFD7] bg-white px-3.5 py-2 text-xs font-medium text-[#141413] transition-colors hover:bg-[#FAF9F5] dark:border-[#2E2D28] dark:bg-[#21201C] dark:text-[#F5F4EF] dark:hover:bg-[#282722]"
        >
          <span className="flex items-center gap-2 truncate">
            {hasUserOpenRouterKey ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400 shrink-0" />
            ) : (
              <KeyRound className="h-3.5 w-3.5 text-[#5C5952] dark:text-[#A3A096] shrink-0" />
            )}
            <span className="truncate">OpenRouter API Key</span>
          </span>
          <span className="text-[11px] text-[#7A776E] dark:text-[#8A877E] whitespace-nowrap shrink-0">
            {hasUserOpenRouterKey
              ? 'Active'
              : openRouterConnected
                ? 'Manage'
                : 'Add key'}
          </span>
        </button>

        <div className="flex items-center justify-between gap-2 pt-0.5">
          {!isInstalled && isInstallable ? (
            <button
              type="button"
              onClick={onTriggerInstall}
              className="flex flex-1 min-h-[36px] items-center justify-center gap-1.5 rounded-full bg-[#141413] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#2B2A27] dark:bg-[#F5F4EF] dark:text-[#141413] dark:hover:bg-[#E5E2DA] whitespace-nowrap shrink-0"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Install App</span>
            </button>
          ) : (
            <span className="px-1 text-[11px] text-[#7A776E] dark:text-[#8A877E] whitespace-nowrap">
              Free plan · Nova AI
            </span>
          )}

          {/* Theme Segmented Control */}
          <div
            className="flex items-center rounded-xl border border-[#E2DFD7] bg-white p-0.5 dark:border-[#2E2D28] dark:bg-[#21201C] shrink-0"
            role="group"
            aria-label="Color theme"
          >
            <button
              type="button"
              onClick={() => onChangeTheme(ThemePreference.LIGHT)}
              aria-label="Light mode"
              aria-pressed={theme === ThemePreference.LIGHT}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                theme === ThemePreference.LIGHT
                  ? 'bg-[#EFECE6] text-[#141413] dark:bg-[#32312B] dark:text-[#F5F4EF]'
                  : 'text-[#8A877E] hover:text-[#141413] dark:hover:text-[#F5F4EF]'
              }`}
            >
              <Sun className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onChangeTheme(ThemePreference.DARK)}
              aria-label="Dark mode"
              aria-pressed={theme === ThemePreference.DARK}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                theme === ThemePreference.DARK
                  ? 'bg-[#EFECE6] text-[#141413] dark:bg-[#32312B] dark:text-[#F5F4EF]'
                  : 'text-[#8A877E] hover:text-[#141413] dark:hover:text-[#F5F4EF]'
              }`}
            >
              <Moon className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onChangeTheme(ThemePreference.SYSTEM)}
              aria-label="System theme"
              aria-pressed={theme === ThemePreference.SYSTEM}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                theme === ThemePreference.SYSTEM
                  ? 'bg-[#EFECE6] text-[#141413] dark:bg-[#32312B] dark:text-[#F5F4EF]'
                  : 'text-[#8A877E] hover:text-[#141413] dark:hover:text-[#F5F4EF]'
              }`}
            >
              <Monitor className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );

  return (
    <>
      {/* Desktop docked sidebar when open */}
      <div className="hidden lg:block lg:shrink-0">{sidebarBody}</div>

      {/* Mobile / tablet slide-over drawer */}
      <div
        className="fixed inset-0 z-50 flex lg:hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
      >
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity"
          onClick={onClose}
        />
        <div className="relative z-10 flex h-full">{sidebarBody}</div>
      </div>
    </>
  );
};
