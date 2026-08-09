import React, { useMemo } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import type { Dimension, ProbeResult, ProbeStatus, Provider } from '@/types';
import { ALL_DIMENSIONS } from '@/types';
import { CASE_KIND_LABELS, DIMENSION_META } from '@/constants/dimensions';
import { STATUS_COLORS } from '@/theme';
import type { Probe } from '@/engine/probes/Probe';
import { defaultProbeRegistry } from '@/engine/ProbeRegistry';
import EmptyState from '@/components/common/EmptyState';

const STATUS_LABELS: Readonly<Record<ProbeStatus, string>> = Object.freeze({
  pass: '通过',
  fail: '未通过',
  skip: '已跳过',
  error: '执行异常',
});

export interface ProbeMatrixProps {
  providers: Provider[];
  /** providerId → 该 Provider 已产出的探针结果。 */
  probeResults: Record<string, ProbeResult[]>;
  /** providerId → 正在执行的 probeId。 */
  runningProbes?: Record<string, string | undefined>;
  onCellClick?(providerId: string, probeId: string): void;
}

interface DimensionGroup {
  dimension: Dimension;
  label: string;
  color: string;
  probes: Probe[];
}

function statusIcon(status: ProbeStatus): React.ReactElement {
  switch (status) {
    case 'pass':
      return <CheckCircleIcon fontSize="small" sx={{ color: STATUS_COLORS.success }} />;
    case 'fail':
      return <CancelIcon fontSize="small" sx={{ color: STATUS_COLORS.danger }} />;
    case 'error':
      return <ErrorOutlineIcon fontSize="small" sx={{ color: STATUS_COLORS.warning }} />;
    case 'skip':
    default:
      return <RemoveCircleOutlineIcon fontSize="small" sx={{ color: STATUS_COLORS.unknown }} />;
  }
}

/** 单元格提示语：跳过/异常时把原因带出来，否则光看图标无法定位问题。 */
function cellTooltip(providerName: string, probe: Probe, result: ProbeResult | undefined, running: boolean): string {
  const head = `${providerName} · ${CASE_KIND_LABELS[probe.caseKind]}`;
  if (running) return `${head}：进行中`;
  if (!result) return `${head}：尚未开始`;
  const detail = result.skipReason ?? result.errorMessage;
  const score = typeof result.rawScore === 'number' ? `，原始分 ${Math.round(result.rawScore)}` : '';
  return detail
    ? `${head}：${STATUS_LABELS[result.status]}${score} — ${detail}`
    : `${head}：${STATUS_LABELS[result.status]}${score}`;
}

/**
 * 探针 × 模型执行矩阵。
 *
 * 行序取自 ProbeRegistry.resolve(dimension)，与引擎的实际编排顺序一致，
 * 这样矩阵从上往下填充的观感与真实执行顺序吻合。
 */
const ProbeMatrix: React.FC<ProbeMatrixProps> = ({
  providers,
  probeResults,
  runningProbes = {},
  onCellClick,
}) => {
  const groups = useMemo<DimensionGroup[]>(
    () =>
      ALL_DIMENSIONS.map((dimension) => {
        const meta = DIMENSION_META.find((m) => m.key === dimension);
        return {
          dimension,
          label: meta?.label ?? dimension,
          color: meta?.color ?? STATUS_COLORS.unknown,
          probes: defaultProbeRegistry.resolve(dimension),
        };
      }).filter((g) => g.probes.length > 0),
    [],
  );

  /** providerId → probeId → result，避免每个单元格都做一次线性查找。 */
  const lookup = useMemo<Record<string, Record<string, ProbeResult>>>(() => {
    const out: Record<string, Record<string, ProbeResult>> = {};
    Object.entries(probeResults).forEach(([providerId, list]) => {
      const byProbe: Record<string, ProbeResult> = {};
      list.forEach((r) => {
        byProbe[r.probeId] = r;
      });
      out[providerId] = byProbe;
    });
    return out;
  }, [probeResults]);

  if (providers.length === 0) {
    return (
      <EmptyState
        title="尚未选择待测模型"
        description="选好 Provider 并启动任务后，这里会实时展示每个探针在每个模型上的执行结果。"
        minHeight={160}
      />
    );
  }

  return (
    <TableContainer>
      <Table stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell sx={{ minWidth: 140 }}>探针</TableCell>
            {providers.map((p) => (
              <TableCell key={p.id} align="center" sx={{ minWidth: 96 }}>
                <Tooltip title={`${p.name} · ${p.model}`}>
                  <Typography variant="caption" noWrap component="div" sx={{ fontWeight: 600 }}>
                    {p.name}
                  </Typography>
                </Tooltip>
              </TableCell>
            ))}
          </TableRow>
        </TableHead>

        <TableBody>
          {groups.map((group) => (
            <React.Fragment key={group.dimension}>
              <TableRow>
                <TableCell colSpan={providers.length + 1} sx={{ backgroundColor: '#f8fafc' }}>
                  <Chip
                    label={group.label}
                    sx={{ backgroundColor: group.color, color: '#fff', fontWeight: 600 }}
                  />
                </TableCell>
              </TableRow>

              {group.probes.map((probe) => (
                <TableRow key={probe.id} hover>
                  <TableCell>
                    <Typography variant="body2">{CASE_KIND_LABELS[probe.caseKind]}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {probe.id}
                    </Typography>
                  </TableCell>

                  {providers.map((p) => {
                    const result = lookup[p.id]?.[probe.id];
                    const running = runningProbes[p.id] === probe.id;
                    const clickable = Boolean(onCellClick) && result !== undefined;
                    return (
                      <TableCell key={p.id} align="center">
                        <Tooltip title={cellTooltip(p.name, probe, result, running)}>
                          <Box
                            className="inline-flex items-center justify-center"
                            role={clickable ? 'button' : undefined}
                            tabIndex={clickable ? 0 : undefined}
                            onClick={clickable ? () => onCellClick?.(p.id, probe.id) : undefined}
                            onKeyDown={
                              clickable
                                ? (e: React.KeyboardEvent<HTMLDivElement>) => {
                                    if (e.key === 'Enter' || e.key === ' ') onCellClick?.(p.id, probe.id);
                                  }
                                : undefined
                            }
                            sx={{ cursor: clickable ? 'pointer' : 'default', width: 24, height: 24 }}
                          >
                            {running ? (
                              <CircularProgress size={16} thickness={5} />
                            ) : result ? (
                              statusIcon(result.status)
                            ) : (
                              <RadioButtonUncheckedIcon fontSize="small" sx={{ color: '#cbd5e1' }} />
                            )}
                          </Box>
                        </Tooltip>
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </React.Fragment>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

export default ProbeMatrix;
