import React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import DataObjectOutlinedIcon from '@mui/icons-material/DataObjectOutlined';
import TableViewOutlinedIcon from '@mui/icons-material/TableViewOutlined';
import CompareArrowsOutlinedIcon from '@mui/icons-material/CompareArrowsOutlined';
import SummarizeOutlinedIcon from '@mui/icons-material/SummarizeOutlined';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import type { EvaluationResult } from '@/types';
import {
  downloadBlob,
  exportComparisonCsv,
  exportComparisonJson,
  exportResultCsv,
  exportResultJson,
  exportSummaryCsv,
} from '@/lib/export';
import { buildReportFileName, buildReportHtml } from '@/lib/reportHtml';
import { IS_DESKTOP } from '@/lib/env';
import { useUiStore } from '@/store/uiStore';

export interface ExportButtonsProps {
  results: EvaluationResult[];
  size?: 'small' | 'medium';
  /** 强制使用对比样式（即使只有 1 条结果）。 */
  forceComparison?: boolean;
}

/**
 * 导出入口。全部走 Blob + a[download]，不存在任何服务端上报路径，
 * 因此导出内容里的原始响应片段不会离开本机。
 */
const ExportButtons: React.FC<ExportButtonsProps> = ({
  results,
  size = 'small',
  forceComparison = false,
}) => {
  const showSnackbar = useUiStore((s) => s.showSnackbar);
  const empty = results.length === 0;
  const comparison = forceComparison || results.length > 1;

  const guard = (fn: () => void, message: string) => (): void => {
    if (empty) {
      showSnackbar('没有可导出的结果', 'warning');
      return;
    }
    fn();
    showSnackbar(message, 'success');
  };

  const handleHtml = (): void => {
    if (empty) {
      showSnackbar('没有可导出的结果', 'warning');
      return;
    }
    const html = buildReportHtml(results);
    if (!html) return;
    const name = buildReportFileName(results);
    if (IS_DESKTOP && typeof window !== 'undefined' && window.electronAPI) {
      window.electronAPI.saveReport(html, name).then((p) => {
        if (p) showSnackbar(`报告已保存：${p}`, 'success');
      });
    } else {
      downloadBlob(html, name, 'text/html;charset=utf-8');
      showSnackbar('已导出 HTML 报告', 'success');
    }
  };

  if (!comparison) {
    const single = results[0];
    return (
      <Box className="flex flex-wrap items-center gap-1">
        <Tooltip title="完整 EvaluationResult，含配置快照与探针明细，可用于复现与审计">
          <span>
            <Button
              size={size}
              variant="outlined"
              disabled={empty}
              startIcon={<DataObjectOutlinedIcon />}
              onClick={guard(() => exportResultJson(single), '已导出结果 JSON')}
            >
              导出 JSON
            </Button>
          </span>
        </Tooltip>
        <Tooltip title="扁平指标表，带 UTF-8 BOM，可直接用 Excel 打开">
          <span>
            <Button
              size={size}
              variant="outlined"
              disabled={empty}
              startIcon={<TableViewOutlinedIcon />}
              onClick={guard(() => exportResultCsv(single), '已导出结果 CSV')}
            >
              导出 CSV
            </Button>
          </span>
        </Tooltip>
        <Tooltip title="自包含 HTML 报告（内联图表，可离线打开与分享）">
          <span>
            <Button
              size={size}
              variant="contained"
              disabled={empty}
              startIcon={<DescriptionOutlinedIcon />}
              onClick={handleHtml}
            >
              导出 HTML 报告
            </Button>
          </span>
        </Tooltip>
      </Box>
    );
  }

  return (
    <Box className="flex flex-wrap items-center gap-1">
      <Tooltip title="一行一个模型的概览表，适合直接贴进汇报文档">
        <span>
          <Button
            size={size}
            variant="outlined"
            disabled={empty}
            startIcon={<SummarizeOutlinedIcon />}
            onClick={guard(() => exportSummaryCsv(results), '已导出概览 CSV')}
          >
            概览 CSV
          </Button>
        </span>
      </Tooltip>
      <Tooltip title="行=指标、列=各模型的对比明细表">
        <span>
          <Button
            size={size}
            variant="outlined"
            disabled={empty}
            startIcon={<CompareArrowsOutlinedIcon />}
            onClick={guard(() => exportComparisonCsv(results), '已导出对比 CSV')}
          >
            对比 CSV
          </Button>
        </span>
      </Tooltip>
      <Tooltip title="所选结果的完整 JSON 数组">
        <span>
          <Button
            size={size}
            variant="outlined"
            disabled={empty}
            startIcon={<DataObjectOutlinedIcon />}
            onClick={guard(() => exportComparisonJson(results), '已导出对比 JSON')}
          >
            对比 JSON
          </Button>
        </span>
      </Tooltip>
      <Tooltip title="自包含 HTML 报告（内联图表，可离线打开与分享）">
        <span>
          <Button
            size={size}
            variant="contained"
            disabled={empty}
            startIcon={<DescriptionOutlinedIcon />}
            onClick={handleHtml}
          >
            导出 HTML 报告
          </Button>
        </span>
      </Tooltip>
    </Box>
  );
};

export default ExportButtons;
