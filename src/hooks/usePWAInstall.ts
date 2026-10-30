import { useEffect, useState } from 'react';
import { ThemePreference } from '../types/nova.ts';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsInstalled(isStandalone);

    const ua = window.navigator.userAgent.toLowerCase();
    setIsIOS(/iphone|ipad|ipod/.test(ua));

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const install = async (): Promise<boolean> => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      setDeferredPrompt(null);
      return true;
    }
    return false;
  };

  return {
    isInstallable: Boolean(deferredPrompt),
    isInstalled,
    isIOS,
    install,
  };
}

export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  return isOnline;
}

const THEME_STORAGE_KEY = 'nova_ai_theme_v2';

export function useTheme() {
  const [theme, setTheme] = useState<ThemePreference>(() => {
    if (typeof window === 'undefined') return ThemePreference.LIGHT;
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === ThemePreference.LIGHT || saved === ThemePreference.DARK || saved === ThemePreference.SYSTEM) {
      return saved;
    }
    return ThemePreference.LIGHT;
  });

  const [resolvedDark, setResolvedDark] = useState<boolean>(false);

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia('(prefers-color-scheme: dark)');

    const apply = () => {
      const isDark =
        theme === ThemePreference.DARK ||
        (theme === ThemePreference.SYSTEM && media.matches);
      root.classList.toggle('dark', isDark);
      setResolvedDark(isDark);
      const metaTheme = document.querySelector('meta[name="theme-color"]');
      if (metaTheme) {
        metaTheme.setAttribute('content', isDark ? '#11100E' : '#F8F6F0');
      }
    };

    apply();
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore storage errors
    }

    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);

  return { theme, setTheme, resolvedDark };
}
