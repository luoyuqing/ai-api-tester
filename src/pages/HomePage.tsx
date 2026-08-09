import React, { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import InsightsOutlinedIcon from '@mui/icons-material/InsightsOutlined';
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined';
import SpeedOutlinedIcon from '@mui/icons-material/SpeedOutlined';
import ExtensionOutlinedIcon from '@mui/icons-material/ExtensionOutlined';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';
import { useProviderStore } from '@/store/providerStore';
import { useResultStore } from '@/store/resultStore';
import { DIMENSION_META, SUB_METRIC_META } from '@/constants/dimensions';
import { ENGINE_VERSION } from '@/constants/defaults';
import ScoreBadge from '@/components/common/ScoreBadge';
import { formatTimestamp } from '@/lib/timer';

interface QuickEntry {
  title: string;
  desc: string;
  icon: React.ReactElement;
  to: string;
  cta: string;
}

const QUICK_ENTRIES: QuickEntry[] = [
  {
    title: '配置中心',
    desc: '录入待测 Provider（Endpoint / 模型名 / Key），选择用例集与传输方式。',
    icon: <SettingsOutlinedIcon color="primary" />,
    to: '/config',
    cta: '去配置',
  },
  {
    title: '测试执行',
    desc: '勾选目标模型与评测维度，设置并发与超时，实时查看进度与日志。',
    icon: <PlayCircleOutlineIcon color="primary" />,
    to: '/run',
    cta: '去评测',
  },
  {
    title: '结果看板',
    desc: '2-5 个模型同屏对比：雷达图、分组柱状图、指标明细表与证据下钻。',
    icon: <InsightsOutlinedIcon color="primary" />,
    to: '/dashboard',
    cta: '看报告',
  },
  {
    title: '历史记录',
    desc: '按时间 / 模型检索历史评测，载入对比、删除或清空本地归档。',
    icon: <HistoryOutlinedIcon color="primary" />,
    to: '/history',
    cta: '看历史',
  },
];

const DIMENSION_ICONS: Record<string, React.ReactElement> = {
  performance: <SpeedOutlinedIcon fontSize="small" />,
  functionality: <ExtensionOutlinedIcon fontSize="small" />,
  safety: <ShieldOutlinedIcon fontSize="small" />,
};

const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const providers = useProviderStore((s) => s.providers);
  const resultIndex = useResultStore((s) => s.index);
  const refreshIndex = useResultStore((s) => s.refreshIndex);

  useEffect(() => {
    void refreshIndex();
  }, [refreshIndex]);

  const recent = useMemo(
    () => [...resultIndex].sort((a, b) => b.endedAt - a.endedAt).slice(0, 5),
    [resultIndex],
  );

  return (
    <Box className="flex flex-col gap-4">
      {/* 合规声明横幅 */}
      <Alert severity="info" variant="outlined">
        <AlertTitle>合规声明</AlertTitle>
        本平台为<strong>纯前端本地工具</strong>：所有配置、API Key 与评测结果仅保存在本机浏览器
        （localStorage + IndexedDB），<strong>不存在任何服务端上报路径</strong>。 API Key 采用
        AES-GCM-256 加密落盘，日志全程脱敏。破限维度的内置用例集
        <strong>全部为占位符模板</strong>，真实词表需由使用者本地导入；勾选破限维度前需完成合规确认。
      </Alert>

      {/* 概览卡片 */}
      <Box className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="flex flex-col gap-1">
            <Typography variant="overline" color="text.secondary">
              已配置 Provider
            </Typography>
            <Typography variant="h2">{providers.length}</Typography>
            <Typography variant="caption" color="text.secondary">
              建议同时对比 2-5 个模型以保证报告可读性
            </Typography>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1">
            <Typography variant="overline" color="text.secondary">
              本地历史评测
            </Typography>
            <Typography variant="h2">{resultIndex.length}</Typography>
            <Typography variant="caption" color="text.secondary">
              每份结果内嵌完整配置快照，可复现可审计
            </Typography>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1">
            <Typography variant="overline" color="text.secondary">
              引擎版本
            </Typography>
            <Typography variant="h2">v{ENGINE_VERSION}</Typography>
            <Typography variant="caption" color="text.secondary">
              浏览器内评测引擎 · 11 类探针 · 规则判分 + LLM-as-judge
            </Typography>
          </CardContent>
        </Card>
      </Box>

      {/* 评测维度总览 */}
      <Card>
        <CardContent className="flex flex-col gap-3">
          <Typography variant="h4">评测维度</Typography>
          <Box className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {DIMENSION_META.map((dim) => (
              <Box key={dim.key} className="flex flex-col gap-2">
                <Box className="flex items-center gap-2">
                  {DIMENSION_ICONS[dim.key]}
                  <Typography variant="h6">{dim.label}</Typography>
                  <Chip label={`权重 ${(dim.weight * 100).toFixed(0)}%`} variant="outlined" />
                </Box>
                <Typography variant="caption" color="text.secondary">
                  {dim.description}
                </Typography>
                <Box className="flex flex-wrap gap-1">
                  {SUB_METRIC_META.filter((m) => m.dimension === dim.key).map((m) => (
                    <Chip key={m.key} label={`${m.label} · ${m.requirementId}`} size="small" />
                  ))}
                </Box>
              </Box>
            ))}
          </Box>
        </CardContent>
      </Card>

      {/* 快速入口 */}
      <Box className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {QUICK_ENTRIES.map((entry) => (
          <Card key={entry.to} className="flex flex-col">
            <CardContent className="flex flex-1 flex-col gap-2">
              <Box className="flex items-center gap-2">
                {entry.icon}
                <Typography variant="h6">{entry.title}</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary" className="flex-1">
                {entry.desc}
              </Typography>
              <Box>
                <Button size="small" variant="contained" onClick={() => navigate(entry.to)}>
                  {entry.cta}
                </Button>
              </Box>
            </CardContent>
          </Card>
        ))}
      </Box>

      {/* 最近评测 */}
      <Card>
        <CardContent className="flex flex-col gap-2">
          <Typography variant="h4">最近评测</Typography>
          <Divider />
          {recent.length === 0 ? (
            <Typography variant="body2" color="text.secondary" className="py-4">
              暂无历史评测记录。先到「配置中心」添加 Provider，再到「测试执行」发起第一次评测。
            </Typography>
          ) : (
            <Box className="flex flex-col">
              {recent.map((item) => (
                <Box
                  key={item.id}
                  className="flex items-center gap-3 border-b border-slate-100 py-2 last:border-0"
                >
                  <ScoreBadge score={item.overallScore} />
                  <Box className="min-w-0 flex-1">
                    <Typography variant="body2" noWrap>
                      {item.providerName}
                      <Typography component="span" variant="caption" color="text.secondary">
                        {'  '}({item.model})
                      </Typography>
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {formatTimestamp(item.endedAt)}
                    </Typography>
                  </Box>
                  <Button size="small" onClick={() => navigate('/dashboard')}>
                    查看
                  </Button>
                </Box>
              ))}
            </Box>
          )}
        </CardContent>
      </Card>
    </Box>
  );
};

export default HomePage;
