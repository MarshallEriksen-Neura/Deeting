"use client";

import { useState, useEffect } from 'react';
import { useI18n } from '@/lib/i18n-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { useUpstreamProxyConfig } from '@/lib/swr/use-upstream-proxy';
import type { UpdateUpstreamProxyConfigRequest } from '@/lib/api-types';

/**
 * 代理池全局配置卡片
 */
export function UpstreamProxyConfigCard() {
  const { t } = useI18n();
  const { config, loading, error, update, submitting } = useUpstreamProxyConfig();

  const [formData, setFormData] = useState<UpdateUpstreamProxyConfigRequest>({
    enabled: false,
    healthcheck_url: '',
    healthcheck_method: 'GET',
    healthcheck_timeout_ms: 5000,
    healthcheck_interval_seconds: 300,
    failure_cooldown_seconds: 120,
  });

  useEffect(() => {
    if (config) {
      setFormData({
        enabled: config.enabled,
        healthcheck_url: config.healthcheck_url,
        healthcheck_method: config.healthcheck_method,
        healthcheck_timeout_ms: config.healthcheck_timeout_ms,
        healthcheck_interval_seconds: config.healthcheck_interval_seconds,
        failure_cooldown_seconds: config.failure_cooldown_seconds,
      });
    }
  }, [config]);

  const handleReset = () => {
    if (config) {
      setFormData({
        enabled: config.enabled,
        healthcheck_url: config.healthcheck_url,
        healthcheck_method: config.healthcheck_method,
        healthcheck_timeout_ms: config.healthcheck_timeout_ms,
        healthcheck_interval_seconds: config.healthcheck_interval_seconds,
        failure_cooldown_seconds: config.failure_cooldown_seconds,
      });
    }
  };

  const handleSave = async () => {
    try {
      await update(formData);
      toast.success(t('system.upstream_proxy.config.save_success'));
    } catch (err) {
      toast.error(t('system.upstream_proxy.config.save_error'));
    }
  };

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">{error.message}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-normal">
          {t('system.upstream_proxy.config.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* 启用开关 */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label>{t('system.upstream_proxy.config.enabled')}</Label>
            <p className="text-sm text-muted-foreground">
              {t('system.upstream_proxy.config.enabled_hint')}
            </p>
          </div>
          <Switch
            checked={formData.enabled}
            onCheckedChange={(checked) => setFormData({ ...formData, enabled: checked })}
            disabled={loading}
          />
        </div>

        {/* 健康检查 URL */}
        <div className="space-y-2">
          <Label htmlFor="healthcheck_url">
            {t('system.upstream_proxy.config.healthcheck_url')}
          </Label>
          <Input
            id="healthcheck_url"
            value={formData.healthcheck_url}
            onChange={(e) => setFormData({ ...formData, healthcheck_url: e.target.value })}
            disabled={loading}
          />
        </div>

        {/* 健康检查方法 */}
        <div className="space-y-2">
          <Label htmlFor="healthcheck_method">
            {t('system.upstream_proxy.config.healthcheck_method')}
          </Label>
          <Select
            value={formData.healthcheck_method}
            onValueChange={(value: 'GET' | 'HEAD') => 
              setFormData({ ...formData, healthcheck_method: value })
            }
            disabled={loading}
          >
            <SelectTrigger id="healthcheck_method">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="GET">GET</SelectItem>
              <SelectItem value="HEAD">HEAD</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* 健康检查超时 */}
        <div className="space-y-2">
          <Label htmlFor="healthcheck_timeout_ms">
            {t('system.upstream_proxy.config.healthcheck_timeout_ms')}
          </Label>
          <Input
            id="healthcheck_timeout_ms"
            type="number"
            value={formData.healthcheck_timeout_ms}
            onChange={(e) => setFormData({ ...formData, healthcheck_timeout_ms: parseInt(e.target.value) })}
            disabled={loading}
          />
        </div>

        {/* 健康检查间隔 */}
        <div className="space-y-2">
          <Label htmlFor="healthcheck_interval_seconds">
            {t('system.upstream_proxy.config.healthcheck_interval_seconds')}
          </Label>
          <Input
            id="healthcheck_interval_seconds"
            type="number"
            value={formData.healthcheck_interval_seconds}
            onChange={(e) => setFormData({ ...formData, healthcheck_interval_seconds: parseInt(e.target.value) })}
            disabled={loading}
          />
        </div>

        {/* 失败冷却时间 */}
        <div className="space-y-2">
          <Label htmlFor="failure_cooldown_seconds">
            {t('system.upstream_proxy.config.failure_cooldown_seconds')}
          </Label>
          <Input
            id="failure_cooldown_seconds"
            type="number"
            value={formData.failure_cooldown_seconds}
            onChange={(e) => setFormData({ ...formData, failure_cooldown_seconds: parseInt(e.target.value) })}
            disabled={loading}
          />
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={handleReset}
            disabled={loading || submitting}
          >
            {t('system.config.reset')}
          </Button>
          <Button
            onClick={handleSave}
            disabled={loading || submitting}
          >
            {submitting ? t('system.config.saving') : t('system.config.save')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
