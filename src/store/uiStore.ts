import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { STORAGE_KEYS } from '@/constants/defaults';
import { cryptoService, type VaultStrength } from '@/lib/crypto';

export type SnackbarSeverity = 'success' | 'info' | 'warning' | 'error';

export interface SnackbarState {
  open: boolean;
  message: string;
  severity: SnackbarSeverity;
  duration: number;
}

interface UiState {
  sideNavCollapsed: boolean;
  vaultUnlocked: boolean;
  snackbar: SnackbarState;
  /** Remembered so the compliance dialog is not shown on every run. */
  safetyAcknowledged: boolean;

  toggleSideNav(): void;
  setSideNavCollapsed(v: boolean): void;
  showSnackbar(message: string, severity?: SnackbarSeverity, duration?: number): void;
  closeSnackbar(): void;
  unlockVault(passphrase: string): Promise<void>;
  lockVault(): void;
  vaultStrength(): VaultStrength;
  setSafetyAcknowledged(v: boolean): void;
}

const INITIAL_SNACKBAR: SnackbarState = {
  open: false,
  message: '',
  severity: 'info',
  duration: 4000,
};

/**
 * UI-only state. Persisted under `aiat:ui:v1`; the vault unlock flag is
 * deliberately NOT persisted (a reload must re-ask for the passphrase).
 */
export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      sideNavCollapsed: false,
      vaultUnlocked: false,
      snackbar: INITIAL_SNACKBAR,
      safetyAcknowledged: false,

      toggleSideNav: () => set((s) => ({ sideNavCollapsed: !s.sideNavCollapsed })),

      setSideNavCollapsed: (v) => set({ sideNavCollapsed: v }),

      showSnackbar: (message, severity = 'info', duration = 4000) =>
        set({ snackbar: { open: true, message, severity, duration } }),

      closeSnackbar: () => set((s) => ({ snackbar: { ...s.snackbar, open: false } })),

      unlockVault: async (passphrase: string) => {
        await cryptoService.unlock(passphrase);
        if (cryptoService.isCompatMode()) {
          get().showSnackbar(
            '当前为非安全上下文(HTTP)，密钥以兼容模式存储（口令混淆，非强加密）。建议通过 HTTPS 访问以提升安全性。',
            'warning',
            7000,
          );
        }
        set({ vaultUnlocked: true });
      },

      lockVault: () => {
        cryptoService.lock();
        set({ vaultUnlocked: false });
      },

      vaultStrength: () => (get().vaultUnlocked ? cryptoService.strength() : 'locked'),

      setSafetyAcknowledged: (v) => set({ safetyAcknowledged: v }),
    }),
    {
      name: STORAGE_KEYS.UI,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        sideNavCollapsed: s.sideNavCollapsed,
        safetyAcknowledged: s.safetyAcknowledged,
      }),
    },
  ),
);

export default useUiStore;
