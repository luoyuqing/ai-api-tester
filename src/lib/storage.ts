import { createStore, del, get, keys, set } from 'idb-keyval';
import type {
  EvaluationConfig,
  EvaluationResult,
  Provider,
  ResultIndexItem,
  TestSuite,
} from '@/types';
import {
  IDB_DB_NAME,
  IDB_KEY_PREFIX,
  IDB_STORE_NAME,
  SCHEMA_VERSION,
  STORAGE_KEYS,
} from '@/constants/defaults';
import { ENGINE_VERSION } from '@/constants/defaults';
import { cryptoService, type CipherEnvelope } from '@/lib/crypto';
import { logger } from '@/lib/logger';

/**
 * Persistence layer.
 *  - localStorage: small, synchronous records (providers, secrets, configs, index)
 *  - IndexedDB   : bulky records (full results, generated images, imported suites)
 *
 * Everything is namespaced with `aiat:` and versioned so future migrations are
 * a matter of bumping SCHEMA_VERSION and adding a step to `migrate()`.
 */

export interface AppMeta {
  schemaVersion: number;
  engineVersion: string;
  createdAt: number;
  updatedAt: number;
}

export interface AppSettings {
  /** Per-metric weight overrides, keyed by MetricRecord.key. */
  weights: Record<string, number>;
  defaultTransport: 'direct' | 'proxy';
  /** Remember the compliance acknowledgement for the safety dimension. */
  safetyAcknowledged: boolean;
  /** Locally imported placeholder dictionary (kept in memory-ish; opt-in persist). */
  persistPlaceholders: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  weights: {},
  defaultTransport: 'direct',
  safetyAcknowledged: false,
  persistPlaceholders: false,
};

export interface Repository {
  init(): Promise<void>;
  listProviders(): Promise<Provider[]>;
  saveProvider(p: Provider, plainKey?: string): Promise<void>;
  deleteProvider(id: string): Promise<void>;
  getSecret(secretRef: string): Promise<string>;
  hasSecret(secretRef: string): boolean;
  saveSecret(secretRef: string, plainKey: string): Promise<void>;
  deleteSecret(secretRef: string): Promise<void>;
  listConfigs(): Promise<EvaluationConfig[]>;
  saveConfig(c: EvaluationConfig): Promise<void>;
  deleteConfig(id: string): Promise<void>;
  listResultIndex(): Promise<ResultIndexItem[]>;
  saveResult(r: EvaluationResult): Promise<void>;
  getResult(id: string): Promise<EvaluationResult | null>;
  deleteResult(id: string): Promise<void>;
  clearResults(): Promise<void>;
  saveImage(probeId: string, dataUrl: string): Promise<void>;
  getImage(probeId: string): Promise<string | null>;
  listCustomSuites(): Promise<TestSuite[]>;
  saveCustomSuite(s: TestSuite): Promise<void>;
  deleteCustomSuite(id: string): Promise<void>;
  getSettings(): AppSettings;
  saveSettings(s: AppSettings): void;
}

// ───────────────────────── localStorage helpers ─────────────────────────

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch (err) {
    logger.warn('SYS', `读取本地存储失败 ${key}: ${(err as Error).message}`);
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    logger.error('SYS', `写入本地存储失败 ${key}: ${(err as Error).message}`);
    throw err;
  }
}

type SecretVault = Record<string, CipherEnvelope>;

// ───────────────────────── implementation ─────────────────────────

export class LocalRepository implements Repository {
  private readonly idbStore = createStore(IDB_DB_NAME, IDB_STORE_NAME);

  /** Ensure the meta record exists and run pending migrations. */
  public async init(): Promise<void> {
    const meta = readJson<AppMeta | null>(STORAGE_KEYS.META, null);
    if (!meta) {
      writeJson(STORAGE_KEYS.META, {
        schemaVersion: SCHEMA_VERSION,
        engineVersion: ENGINE_VERSION,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } satisfies AppMeta);
      return;
    }
    if (meta.schemaVersion < SCHEMA_VERSION) {
      await this.migrate(meta.schemaVersion);
      writeJson(STORAGE_KEYS.META, {
        ...meta,
        schemaVersion: SCHEMA_VERSION,
        engineVersion: ENGINE_VERSION,
        updatedAt: Date.now(),
      } satisfies AppMeta);
    }
  }

  /**
   * Migration hook. v1 is the initial schema, so there is nothing to do yet —
   * future versions add their steps here in ascending order.
   */
  private async migrate(fromVersion: number): Promise<void> {
    logger.info('SYS', `本地数据结构迁移 v${fromVersion} → v${SCHEMA_VERSION}`);
    // no-op for v1
    await Promise.resolve();
  }

  // ── providers ──

  public async listProviders(): Promise<Provider[]> {
    return readJson<Provider[]>(STORAGE_KEYS.PROVIDERS, []);
  }

  public async saveProvider(p: Provider, plainKey?: string): Promise<void> {
    const list = await this.listProviders();
    const index = list.findIndex((x) => x.id === p.id);
    if (index >= 0) list[index] = p;
    else list.push(p);
    writeJson(STORAGE_KEYS.PROVIDERS, list);
    if (plainKey !== undefined && plainKey !== '') {
      await this.saveSecret(p.secretRef, plainKey);
    }
  }

  public async deleteProvider(id: string): Promise<void> {
    const list = await this.listProviders();
    const target = list.find((x) => x.id === id);
    writeJson(
      STORAGE_KEYS.PROVIDERS,
      list.filter((x) => x.id !== id),
    );
    if (target) await this.deleteSecret(target.secretRef);
  }

  // ── secrets ──

  private readVault(): SecretVault {
    return readJson<SecretVault>(STORAGE_KEYS.SECRETS, {});
  }

  public hasSecret(secretRef: string): boolean {
    return Boolean(this.readVault()[secretRef]);
  }

  public async saveSecret(secretRef: string, plainKey: string): Promise<void> {
    const envelope = await cryptoService.encrypt(plainKey);
    const vault = this.readVault();
    vault[secretRef] = envelope;
    writeJson(STORAGE_KEYS.SECRETS, vault);
  }

  /** Returns the decrypted key. Only ever passed around in memory. */
  public async getSecret(secretRef: string): Promise<string> {
    const envelope = this.readVault()[secretRef];
    if (!envelope) return '';
    return cryptoService.decrypt(envelope);
  }

  public async deleteSecret(secretRef: string): Promise<void> {
    const vault = this.readVault();
    if (secretRef in vault) {
      delete vault[secretRef];
      writeJson(STORAGE_KEYS.SECRETS, vault);
    }
    await Promise.resolve();
  }

  // ── configs ──

  public async listConfigs(): Promise<EvaluationConfig[]> {
    return readJson<EvaluationConfig[]>(STORAGE_KEYS.CONFIGS, []);
  }

  public async saveConfig(c: EvaluationConfig): Promise<void> {
    const list = await this.listConfigs();
    const index = list.findIndex((x) => x.id === c.id);
    if (index >= 0) list[index] = c;
    else list.push(c);
    writeJson(STORAGE_KEYS.CONFIGS, list);
  }

  public async deleteConfig(id: string): Promise<void> {
    const list = await this.listConfigs();
    writeJson(
      STORAGE_KEYS.CONFIGS,
      list.filter((x) => x.id !== id),
    );
  }

  // ── results ──

  public async listResultIndex(): Promise<ResultIndexItem[]> {
    return readJson<ResultIndexItem[]>(STORAGE_KEYS.RESULT_INDEX, []);
  }

  private writeResultIndex(items: ResultIndexItem[]): void {
    writeJson(STORAGE_KEYS.RESULT_INDEX, items);
  }

  public async saveResult(r: EvaluationResult): Promise<void> {
    await set(`${IDB_KEY_PREFIX.RESULT}${r.id}`, r, this.idbStore);
    const index = await this.listResultIndex();
    const item = toIndexItem(r);
    const pos = index.findIndex((x) => x.id === r.id);
    if (pos >= 0) index[pos] = item;
    else index.push(item);
    this.writeResultIndex(index);
  }

  public async getResult(id: string): Promise<EvaluationResult | null> {
    const value = await get<EvaluationResult>(`${IDB_KEY_PREFIX.RESULT}${id}`, this.idbStore);
    return value ?? null;
  }

  public async deleteResult(id: string): Promise<void> {
    await del(`${IDB_KEY_PREFIX.RESULT}${id}`, this.idbStore);
    const index = await this.listResultIndex();
    this.writeResultIndex(index.filter((x) => x.id !== id));
  }

  public async clearResults(): Promise<void> {
    const allKeys = await keys(this.idbStore);
    await Promise.all(
      allKeys
        .filter((k) => typeof k === 'string' && k.startsWith(IDB_KEY_PREFIX.RESULT))
        .map((k) => del(k as string, this.idbStore)),
    );
    this.writeResultIndex([]);
  }

  // ── images ──

  public async saveImage(probeId: string, dataUrl: string): Promise<void> {
    await set(`${IDB_KEY_PREFIX.IMAGE}${probeId}`, dataUrl, this.idbStore);
  }

  public async getImage(probeId: string): Promise<string | null> {
    const value = await get<string>(`${IDB_KEY_PREFIX.IMAGE}${probeId}`, this.idbStore);
    return value ?? null;
  }

  // ── custom suites ──

  public async listCustomSuites(): Promise<TestSuite[]> {
    const allKeys = await keys(this.idbStore);
    const suiteKeys = allKeys.filter(
      (k) => typeof k === 'string' && k.startsWith(IDB_KEY_PREFIX.SUITE),
    ) as string[];
    const suites = await Promise.all(suiteKeys.map((k) => get<TestSuite>(k, this.idbStore)));
    return suites.filter((s): s is TestSuite => Boolean(s));
  }

  public async saveCustomSuite(s: TestSuite): Promise<void> {
    await set(`${IDB_KEY_PREFIX.SUITE}${s.id}`, s, this.idbStore);
  }

  public async deleteCustomSuite(id: string): Promise<void> {
    await del(`${IDB_KEY_PREFIX.SUITE}${id}`, this.idbStore);
  }

  // ── settings ──

  public getSettings(): AppSettings {
    return { ...DEFAULT_SETTINGS, ...readJson<Partial<AppSettings>>(STORAGE_KEYS.SETTINGS, {}) };
  }

  public saveSettings(s: AppSettings): void {
    writeJson(STORAGE_KEYS.SETTINGS, s);
  }
}

/** Project a full result down to its index row. */
export function toIndexItem(r: EvaluationResult): ResultIndexItem {
  const pick = (d: string): number | null =>
    r.dimensionScores.find((x) => x.dimension === d)?.score ?? null;
  return {
    id: r.id,
    taskId: r.taskId,
    providerId: r.providerId,
    providerName: r.providerName,
    model: r.model,
    overallScore: r.overallScore,
    performanceScore: pick('performance'),
    functionalityScore: pick('functionality'),
    safetyScore: pick('safety'),
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    engineVersion: r.engineVersion,
    configName: r.configSnapshot.name,
  };
}

/** Shared singleton repository. */
export const repository: Repository = new LocalRepository();

export default repository;
