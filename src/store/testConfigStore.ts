import { create } from 'zustand';
import type { EvaluationConfig, PlaceholderDictionary, TestSuite } from '@/types';
import { repository } from '@/lib/storage';
import { uuid } from '@/lib/id';
import { logger } from '@/lib/logger';
import { BUILTIN_SUITES } from '@/data/testsets';
import { createDefaultEvaluationConfig } from '@/constants/defaults';

interface TestConfigState {
  /** Working copy currently being edited on the execution page. */
  draft: EvaluationConfig;
  /** Saved configs, including templates (CONF-02). */
  configs: EvaluationConfig[];
  /** Builtin + user-imported suites. */
  suites: TestSuite[];
  /**
   * Locally imported placeholder dictionary for the safety suites.
   * Kept in memory by default; persisting it is an explicit opt-in because the
   * repository must stay free of restricted vocabulary.
   */
  placeholders: PlaceholderDictionary;
  loading: boolean;

  load(): Promise<void>;
  setDraft(patch: Partial<EvaluationConfig>): void;
  resetDraft(): void;
  saveAsTemplate(name: string): Promise<EvaluationConfig>;
  saveConfig(config: EvaluationConfig): Promise<void>;
  applyTemplate(id: string): void;
  deleteConfig(id: string): Promise<void>;
  importSuite(suite: TestSuite): Promise<void>;
  removeSuite(id: string): Promise<void>;
  setPlaceholders(dict: PlaceholderDictionary): void;
  clearPlaceholders(): void;
  getSelectedSuites(): TestSuite[];
}

function freshDraft(): EvaluationConfig {
  return {
    ...createDefaultEvaluationConfig(),
    id: uuid(),
    createdAt: Date.now(),
  };
}

export const useTestConfigStore = create<TestConfigState>()((set, get) => ({
  draft: freshDraft(),
  configs: [],
  suites: [...BUILTIN_SUITES],
  placeholders: {},
  loading: false,

  load: async () => {
    set({ loading: true });
    try {
      await repository.init();
      const [configs, custom] = await Promise.all([
        repository.listConfigs(),
        repository.listCustomSuites(),
      ]);
      set({
        configs,
        suites: [...BUILTIN_SUITES, ...custom],
        loading: false,
      });
    } catch (err) {
      logger.error('SYS', `加载评测配置失败：${(err as Error).message}`);
      set({ loading: false });
    }
  },

  setDraft: (patch) => set((s) => ({ draft: { ...s.draft, ...patch } })),

  resetDraft: () => set({ draft: freshDraft() }),

  saveAsTemplate: async (name) => {
    const template: EvaluationConfig = {
      ...get().draft,
      id: uuid(),
      name,
      isTemplate: true,
      createdAt: Date.now(),
    };
    await repository.saveConfig(template);
    set((s) => ({ configs: [...s.configs, template] }));
    logger.success('SYS', `已存为模板「${name}」`);
    return template;
  },

  saveConfig: async (config) => {
    await repository.saveConfig(config);
    const list = [...get().configs];
    const index = list.findIndex((c) => c.id === config.id);
    if (index >= 0) list[index] = config;
    else list.push(config);
    set({ configs: list });
  },

  applyTemplate: (id) => {
    const template = get().configs.find((c) => c.id === id);
    if (!template) return;
    set({
      draft: {
        ...template,
        id: uuid(),
        isTemplate: false,
        createdAt: Date.now(),
      },
    });
    logger.info('SYS', `已载入模板「${template.name}」`);
  },

  deleteConfig: async (id) => {
    await repository.deleteConfig(id);
    set((s) => ({ configs: s.configs.filter((c) => c.id !== id) }));
  },

  importSuite: async (suite) => {
    await repository.saveCustomSuite(suite);
    const list = get().suites.filter((s) => s.id !== suite.id);
    set({ suites: [...list, suite] });
    logger.success('SYS', `已导入用例集「${suite.name}」(${suite.cases.length} 条)`);
  },

  removeSuite: async (id) => {
    const target = get().suites.find((s) => s.id === id);
    if (!target || target.builtin) {
      logger.warn('SYS', '内置用例集不可删除');
      return;
    }
    await repository.deleteCustomSuite(id);
    set((s) => ({
      suites: s.suites.filter((x) => x.id !== id),
      draft: { ...s.draft, suiteIds: s.draft.suiteIds.filter((x) => x !== id) },
    }));
  },

  setPlaceholders: (dict) => {
    set({ placeholders: dict });
    logger.info('SYS', `已载入本地词表：${Object.keys(dict).length} 个占位符（仅内存，不落盘）`);
  },

  clearPlaceholders: () => {
    set({ placeholders: {} });
    logger.info('SYS', '已清空本地词表');
  },

  getSelectedSuites: () => {
    const { suites, draft } = get();
    return suites.filter((s) => draft.suiteIds.includes(s.id));
  },
}));

export default useTestConfigStore;
