import React, { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import StorageOutlinedIcon from '@mui/icons-material/StorageOutlined';
import type { ConnectivityResult, Provider, ProviderDraft } from '@/types';
import { useProviders, type ProviderImportItem } from '@/hooks/useProviders';
import ProviderCard from '@/components/provider/ProviderCard';
import ProviderForm from '@/components/provider/ProviderForm';
import ProviderImportDialog from '@/components/provider/ProviderImportDialog';
import ConfirmDialog from '@/components/common/ConfirmDialog';
import EmptyState from '@/components/common/EmptyState';
import LoadingState from '@/components/common/LoadingState';

export interface ProviderListProps {
  /** 点击卡片时同步 providerStore.selectedId，默认开启。 */
  selectable?: boolean;
  /** 单列布局（用于窄侧栏）。 */
  dense?: boolean;
}

/** Provider 列表 + 增删改查 + 批量导入的完整闭环。 */
const ProviderList: React.FC<ProviderListProps> = ({ selectable = true, dense = false }) => {
  const {
    providers,
    loading,
    connectivity,
    selectedId,
    reload,
    select,
    save,
    remove,
    hasSecret,
    testConnectivity,
    importProviders,
  } = useProviders();

  const [keyword, setKeyword] = useState<string>('');
  const [formOpen, setFormOpen] = useState<boolean>(false);
  const [editing, setEditing] = useState<Provider | null>(null);
  const [importOpen, setImportOpen] = useState<boolean>(false);
  const [pendingDelete, setPendingDelete] = useState<Provider | null>(null);
  const [deleting, setDeleting] = useState<boolean>(false);
  const [testingId, setTestingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (kw.length === 0) return providers;
    return providers.filter((p) =>
      [p.name, p.model, p.endpoint, ...(p.tags ?? [])].some((field) =>
        field.toLowerCase().includes(kw),
      ),
    );
  }, [providers, keyword]);

  const handleCreate = (): void => {
    setEditing(null);
    setFormOpen(true);
  };

  const handleEdit = (provider: Provider): void => {
    setEditing(provider);
    setFormOpen(true);
  };

  const handleSubmit = async (draft: ProviderDraft, plainKey?: string): Promise<void> => {
    await save(draft, plainKey);
  };

  const handleTestFromCard = async (provider: Provider): Promise<void> => {
    setTestingId(provider.id);
    try {
      await testConnectivity({
        id: provider.id,
        secretRef: provider.secretRef,
        name: provider.name,
        type: provider.type,
        protocol: provider.protocol,
        endpoint: provider.endpoint,
        model: provider.model,
        auth: provider.auth,
        transport: provider.transport,
        supportsStream: provider.supportsStream,
        extraHeaders: provider.extraHeaders,
        timeoutMs: provider.timeoutMs,
        tags: provider.tags,
        imageModel: provider.imageModel,
        note: provider.note,
      });
    } finally {
      setTestingId(null);
    }
  };

  const handleTestFromForm = async (
    draft: ProviderDraft,
    plainKey?: string,
  ): Promise<ConnectivityResult> => testConnectivity(draft, plainKey);

  const handleImport = async (items: ProviderImportItem[]): Promise<number> => importProviders(items);

  const confirmDelete = async (): Promise<void> => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await remove(pendingDelete.id);
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Box className="flex flex-col gap-3">
      <Box className="flex flex-wrap items-center gap-2">
        <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={handleCreate}>
          新增
        </Button>
        <Button
          variant="outlined"
          size="small"
          startIcon={<UploadFileOutlinedIcon />}
          onClick={() => setImportOpen(true)}
        >
          导入 JSON
        </Button>
        <Button
          variant="text"
          size="small"
          startIcon={<RefreshIcon />}
          onClick={() => void reload()}
          disabled={loading}
        >
          刷新
        </Button>
        <Box className="flex-1" />
        <TextField
          size="small"
          placeholder="搜索名称 / 模型 / Endpoint"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          sx={{ maxWidth: 260 }}
        />
      </Box>

      <Typography variant="caption" color="text.secondary">
        共 {providers.length} 个 Provider{keyword ? `，命中 ${filtered.length} 个` : ''}
        ；建议一次对比 2-5 个模型。
      </Typography>

      {loading && providers.length === 0 ? (
        <LoadingState label="正在读取本地 Provider…" />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<StorageOutlinedIcon sx={{ fontSize: 40 }} />}
          title={providers.length === 0 ? '还没有配置任何 Provider' : '没有匹配的 Provider'}
          description={
            providers.length === 0
              ? '点击「新增」录入 Endpoint / 模型名 / API Key，或用「导入 JSON」批量添加。'
              : '换个关键词试试。'
          }
          action={
            providers.length === 0 ? (
              <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={handleCreate}>
                新增 Provider
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Box
          className={
            dense ? 'grid grid-cols-1 gap-3' : 'grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3'
          }
        >
          {filtered.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              connectivity={connectivity[provider.id]}
              hasSecret={hasSecret(provider.id)}
              selected={selectable && selectedId === provider.id}
              testing={testingId === provider.id}
              onSelect={selectable ? select : undefined}
              onEdit={handleEdit}
              onDelete={setPendingDelete}
              onTest={(p) => void handleTestFromCard(p)}
            />
          ))}
        </Box>
      )}

      <ProviderForm
        open={formOpen}
        initial={editing}
        hasExistingSecret={editing ? hasSecret(editing.id) : false}
        onClose={() => setFormOpen(false)}
        onSubmit={handleSubmit}
        onTest={handleTestFromForm}
      />

      <ProviderImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImport={handleImport}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除 Provider"
        danger
        busy={deleting}
        confirmText="删除"
        content={
          pendingDelete
            ? `确定删除「${pendingDelete.name}」吗？该操作会同时清除本地保存的加密 API Key，且不可恢复。已产生的历史评测结果不受影响。`
            : ''
        }
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      />
    </Box>
  );
};

export default ProviderList;
