import { STORAGE_KEYS } from '@/constants/defaults';

/**
 * WebCrypto AES-GCM secret vault.
 *
 * Security model (documented in the UI):
 *  - STRONG: user supplies a session passphrase → PBKDF2-SHA256(200k) → AES-GCM-256.
 *    The passphrase and derived key live only in memory for the tab's lifetime.
 *  - WEAK  : no passphrase → a random per-device key is generated and kept in
 *    localStorage. This only protects against casual inspection, not against an
 *    attacker with local machine access. The UI states this explicitly.
 */

export const PBKDF2_ITERATIONS = 200_000;
const AES_KEY_LENGTH = 256;
const IV_BYTES = 12;
const SALT_BYTES = 16;

export type VaultStrength = 'strong' | 'weak' | 'locked';

export interface CipherEnvelope {
  /** base64 initialisation vector */
  iv: string;
  /** base64 ciphertext */
  cipherText: string;
  /** Which key material produced this envelope. */
  strength: Exclude<VaultStrength, 'locked'>;
  /** Envelope format version for future migrations. */
  v: 1;
  /** compat mode (non-secure context / no WebCrypto): passphrase-XOR obfuscation. */
  compat?: boolean;
  /** Integrity checksum used by compat mode. */
  checksum?: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * WebCrypto's `BufferSource` (TS 5.7+ lib) requires an `ArrayBuffer`-backed
 * view, but `Uint8Array` defaults to `Uint8Array<ArrayBufferLike>` which TS
 * cannot prove is not a `SharedArrayBuffer`. This coercion satisfies the type
 * without copying — the views are used only for immediate crypto calls.
 */
function toBufferSource(bytes: Uint8Array): BufferSource {
  return bytes as unknown as BufferSource;
}

/** True only in a secure context (https:// or localhost). `crypto.subtle` is gated by it. */
export function isCryptoSubtleAvailable(): boolean {
  const c = globalThis.crypto as (Crypto & { subtle?: SubtleCrypto }) | undefined;
  return Boolean(c && c.subtle);
}

function subtle(): SubtleCrypto {
  const c = globalThis.crypto as (Crypto & { subtle?: SubtleCrypto }) | undefined;
  if (!c || !c.subtle) {
    throw new Error('WebCrypto 不可用：请通过 https 或 localhost 访问本应用');
  }
  return c.subtle;
}

// ─────────────────────────────────────────────────────────────────────────────
// Compat cipher (non-secure context only)
//
// When `crypto.subtle` is unavailable (page served over plain HTTP on a
// non-localhost origin), AES-GCM cannot run in the browser. We fall back to a
// passphrase-gated XOR obfuscation: same UX (the user must still supply the
// session passphrase to unlock/decrypt), but cryptographically weak — it only
// protects against casual inspection, on par with the existing `weak` device
// key. `crypto.getRandomValues` IS available in non-secure contexts, so the IV
// is still random.
// ─────────────────────────────────────────────────────────────────────────────

/** FNV-1a + xorshift keystream derived from (iv || passphrase). */
function compatKeystream(iv: Uint8Array, passphrase: string, length: number): Uint8Array {
  const pBytes = encoder.encode(passphrase);
  const data = new Uint8Array(iv.length + pBytes.length);
  data.set(iv, 0);
  data.set(pBytes, iv.length);
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < data.length; i += 1) {
    h ^= data[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const out = new Uint8Array(length);
  let state = h || 0x9e3779b9;
  for (let i = 0; i < length; i += 1) {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;
    state >>>= 0;
    out[i] = state & 0xff;
  }
  return out;
}

function compatEncrypt(plain: string, passphrase: string): CipherEnvelope {
  const iv = randomBytes(16);
  const pt = encoder.encode(plain);
  const ks = compatKeystream(iv, passphrase, pt.length);
  const ct = new Uint8Array(pt.length);
  let checksum = 0;
  for (let i = 0; i < pt.length; i += 1) {
    ct[i] = pt[i] ^ ks[i];
    checksum = (checksum + pt[i]) & 0xffff;
  }
  return { iv: toBase64(iv), cipherText: toBase64(ct), strength: 'weak', v: 1, compat: true, checksum };
}

function compatDecrypt(envelope: CipherEnvelope, passphrase: string): string {
  const iv = fromBase64(envelope.iv);
  const ct = fromBase64(envelope.cipherText);
  const ks = compatKeystream(iv, passphrase, ct.length);
  const pt = new Uint8Array(ct.length);
  let checksum = 0;
  for (let i = 0; i < ct.length; i += 1) {
    pt[i] = ct[i] ^ ks[i];
    checksum = (checksum + pt[i]) & 0xffff;
  }
  if (checksum !== (envelope.checksum ?? -1)) {
    throw new Error('口令错误：无法解密（兼容模式下密钥校验失败）');
  }
  return decoder.decode(pt);
}

/** Stable per-device passphrase for the no-session-passphrase (weak) path. */
function getCompatDevicePassphrase(): string {
  let raw = localStorage.getItem(STORAGE_KEYS.DEVICE_KEY);
  if (!raw) {
    raw = toBase64(randomBytes(32));
    localStorage.setItem(STORAGE_KEYS.DEVICE_KEY, raw);
  }
  return raw;
}

export function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < view.length; i += 1) binary += String.fromCharCode(view[i]);
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/** Read (or lazily create) the persistent PBKDF2 salt for this browser profile. */
export function getOrCreateSalt(): Uint8Array {
  const stored = localStorage.getItem(STORAGE_KEYS.KDF_SALT);
  if (stored) {
    try {
      return fromBase64(stored);
    } catch {
      /* fall through and regenerate */
    }
  }
  const salt = randomBytes(SALT_BYTES);
  localStorage.setItem(STORAGE_KEYS.KDF_SALT, toBase64(salt));
  return salt;
}

/** PBKDF2-SHA256 → AES-GCM key. */
export async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await subtle().importKey('raw', toBufferSource(encoder.encode(passphrase)), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return subtle().deriveKey(
    { name: 'PBKDF2', salt: toBufferSource(salt), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: AES_KEY_LENGTH },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Import (or lazily create) the fallback device key stored in localStorage. */
async function getDeviceKey(): Promise<CryptoKey> {
  let raw = localStorage.getItem(STORAGE_KEYS.DEVICE_KEY);
  if (!raw) {
    raw = toBase64(randomBytes(32));
    localStorage.setItem(STORAGE_KEYS.DEVICE_KEY, raw);
  }
  return subtle().importKey('raw', toBufferSource(fromBase64(raw)), { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

async function encryptWith(key: CryptoKey, plain: string): Promise<{ iv: string; cipherText: string }> {
  const iv = randomBytes(IV_BYTES);
  const buffer = await subtle().encrypt({ name: 'AES-GCM', iv: toBufferSource(iv) }, key, toBufferSource(encoder.encode(plain)));
  return { iv: toBase64(iv), cipherText: toBase64(buffer) };
}

async function decryptWith(key: CryptoKey, iv: string, cipherText: string): Promise<string> {
  const buffer = await subtle().decrypt(
    { name: 'AES-GCM', iv: toBufferSource(fromBase64(iv)) },
    key,
    toBufferSource(fromBase64(cipherText)),
  );
  return decoder.decode(buffer);
}

/**
 * Session-scoped crypto service. A single instance is shared by the repository
 * and the provider store.
 *
 * Two operating modes:
 *  - STRONG  : secure context → AES-GCM via WebCrypto (default).
 *  - COMPAT  : `crypto.subtle` unavailable (plain-HTTP non-localhost) →
 *              passphrase-XOR obfuscation. Same unlock UX, weaker at rest.
 */
export class CryptoService {
  private sessionKey: CryptoKey | null = null;
  private compatPassphrase: string | null = null;
  private compatMode = false;

  /** Derive and cache the session key from a user passphrase. */
  public async unlock(passphrase: string): Promise<void> {
    if (!passphrase || passphrase.length < 6) {
      throw new Error('口令至少 6 位');
    }
    if (isCryptoSubtleAvailable()) {
      this.sessionKey = await deriveKey(passphrase, getOrCreateSalt());
      this.compatMode = false;
      this.compatPassphrase = null;
    } else {
      this.compatMode = true;
      this.compatPassphrase = passphrase;
      this.sessionKey = null;
    }
  }

  /** Drop the in-memory key. Encrypted data stays on disk. */
  public lock(): void {
    this.sessionKey = null;
    this.compatPassphrase = null;
    this.compatMode = false;
  }

  public isUnlocked(): boolean {
    return this.sessionKey !== null || this.compatPassphrase !== null;
  }

  /** True when running without WebCrypto (plain-HTTP non-localhost origin). */
  public isCompatMode(): boolean {
    return this.compatMode;
  }

  public strength(): VaultStrength {
    if (this.sessionKey) return 'strong';
    return 'weak';
  }

  /** Encrypt with the session key when available, otherwise the device key. */
  public async encrypt(plain: string): Promise<CipherEnvelope> {
    if (this.compatMode) {
      const pass = this.compatPassphrase ?? getCompatDevicePassphrase();
      return compatEncrypt(plain, pass);
    }
    if (this.sessionKey) {
      const { iv, cipherText } = await encryptWith(this.sessionKey, plain);
      return { iv, cipherText, strength: 'strong', v: 1 };
    }
    const deviceKey = await getDeviceKey();
    const { iv, cipherText } = await encryptWith(deviceKey, plain);
    return { iv, cipherText, strength: 'weak', v: 1 };
  }

  /**
   * Decrypt an envelope. Throws a friendly error when the vault is locked but
   * the envelope requires the session key, or when the envelope was created in
   * a secure context (AES-GCM) but we are now in a non-secure context.
   */
  public async decrypt(envelope: CipherEnvelope): Promise<string> {
    if (this.compatMode) {
      if (envelope.compat) {
        const pass = this.compatPassphrase ?? getCompatDevicePassphrase();
        return compatDecrypt(envelope, pass);
      }
      throw new Error('此配置需通过 HTTPS 或 localhost 访问才能解密（非兼容模式保存）');
    }
    if (envelope.strength === 'strong') {
      if (!this.sessionKey) {
        throw new Error('密钥库未解锁：请先在顶栏输入会话口令');
      }
      return decryptWith(this.sessionKey, envelope.iv, envelope.cipherText);
    }
    const deviceKey = await getDeviceKey();
    return decryptWith(deviceKey, envelope.iv, envelope.cipherText);
  }
}

/** Shared singleton — never construct a second one. */
export const cryptoService = new CryptoService();

export default cryptoService;
