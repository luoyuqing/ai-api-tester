import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { STORAGE_KEYS } from '@/constants/defaults';

/**
 * User-tunable runtime settings. Persisted to localStorage so a reload keeps
 * the choices. All values are safe to expose (no secrets in here).
 */
export interface AppSettings {
  /** Base URL of the CORS / SSE sidecar. Empty string means "use default". */
  proxyBaseUrl: string;
  /** Set true to remember the user accepted the sidecar-network warning. */
  proxyWarningAcknowledged: boolean;
}

interface SettingsState extends AppSettings {
  setProxyBaseUrl(value: string): void;
  clearProxyBaseUrl(): void;
  acknowledgeProxyWarning(): void;
}

const EMPTY: AppSettings = {
  proxyBaseUrl: '',
  proxyWarningAcknowledged: false,
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...EMPTY,
      setProxyBaseUrl: (value) => set({ proxyBaseUrl: value.trim() }),
      clearProxyBaseUrl: () => set({ proxyBaseUrl: '' }),
      acknowledgeProxyWarning: () => set({ proxyWarningAcknowledged: true }),
    }),
    {
      name: STORAGE_KEYS.SETTINGS,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        proxyBaseUrl: s.proxyBaseUrl,
        proxyWarningAcknowledged: s.proxyWarningAcknowledged,
      }),
    },
  ),
);

export default useSettingsStore;
