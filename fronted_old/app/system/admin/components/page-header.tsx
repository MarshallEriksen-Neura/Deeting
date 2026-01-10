'use client';

import { useI18n } from '@/lib/i18n-context';

/**
 * 页面标题组件
 * 显示国际化的页面标题和描述
 */
export function PageHeader() {
  const { t } = useI18n();

  return (
    <div>
      <h1 className="text-3xl font-bold mb-2">{t('system.admin.title')}</h1>
      <p className="text-muted-foreground">{t('system.admin.subtitle')}</p>
    </div>
  );
}
