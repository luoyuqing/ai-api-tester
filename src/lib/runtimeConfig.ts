import { getDefaultProxyBase } from '@/constants/defaults';
import { useSettingsStore } from '@/store/settingsStore';

/**
 * Resolve the current CORS-sidecar base URL at call-time.
 *
 * Priority:
 *   1. User override in settings (non-empty string)
 *   2. Build-time env (VITE_PROXY_BASE) — only used as a last-resort fallback
 *      when running in a non-browser context
 *   3. Runtime default derived from `window.location.origin` (deployed build)
 *      or `http://localhost:8787` (dev)
 *
 * Reading the store directly every call means a settings change takes effect
 * on the very next request without an app reload.
 */
export function getProxyBase(): string {
  const override = useSettingsStore.getState().proxyBaseUrl;
  if (override && override.length > 0) return override.replace(/\/+$/, '');
  const env = (import.meta.env?.VITE_PROXY_BASE as string | undefined) ?? '';
  if (env.length > 0) return env.replace(/\/+$/, '');
  return getDefaultProxyBase().replace(/\/+$/, '');
}
