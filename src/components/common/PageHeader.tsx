import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

export interface PageHeaderProps {
  title: string;
  description?: React.ReactNode;
  /** 右侧操作区。 */
  actions?: React.ReactNode;
  /** 标题左侧图标。 */
  icon?: React.ReactNode;
}

/** 页面级标题栏，保证四个业务页视觉一致。 */
const PageHeader: React.FC<PageHeaderProps> = ({ title, description, actions, icon }) => (
  <Box className="flex flex-wrap items-start justify-between gap-3">
    <Box className="flex min-w-0 items-start gap-2">
      {icon ? <Box className="mt-0.5 flex text-slate-500">{icon}</Box> : null}
      <Box className="min-w-0">
        <Typography variant="h3">{title}</Typography>
        {description ? (
          <Typography variant="body2" color="text.secondary" className="mt-1">
            {description}
          </Typography>
        ) : null}
      </Box>
    </Box>
    {actions ? <Box className="flex flex-wrap items-center gap-2">{actions}</Box> : null}
  </Box>
);

export default PageHeader;
