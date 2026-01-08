"use client";

import { useState } from 'react';
import { useI18n } from '@/lib/i18n-context';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UpstreamProxyConfigCard } from './config-card';
import { UpstreamProxyStatusCard } from './status-card';
import { UpstreamProxySourcesTable } from './sources-table';
import { UpstreamProxyEndpointsTable } from './endpoints-table';

/**
 * 上游代理池管理客户端组件
 */
export function UpstreamProxyClient() {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState('config');

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div>
        <h1 className="text-3xl font-light tracking-tight">
          {t('system.upstream_proxy.title')}
        </h1>
        <p className="text-muted-foreground mt-2">
          {t('system.upstream_proxy.subtitle')}
        </p>
      </div>

      {/* 状态卡片 */}
      <UpstreamProxyStatusCard />

      {/* 标签页 */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="config">{t('system.upstream_proxy.config.title')}</TabsTrigger>
          <TabsTrigger value="sources">{t('system.upstream_proxy.sources.title')}</TabsTrigger>
          <TabsTrigger value="endpoints">{t('system.upstream_proxy.endpoints.title')}</TabsTrigger>
        </TabsList>

        <TabsContent value="config" className="space-y-4">
          <UpstreamProxyConfigCard />
        </TabsContent>

        <TabsContent value="sources" className="space-y-4">
          <UpstreamProxySourcesTable />
        </TabsContent>

        <TabsContent value="endpoints" className="space-y-4">
          <UpstreamProxyEndpointsTable />
        </TabsContent>
      </Tabs>
    </div>
  );
}
