'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useI18n } from '@/lib/i18n-context';
import { useGatewayConfigForm } from '@/lib/hooks/use-gateway-config-form';

/**
 * 网关配置卡片组件
 * 负责显示和编辑系统网关配置
 */
export function GatewayConfigCard() {
  const { t } = useI18n();
  const {
    form,
    saving,
    error,
    disabled,
    handleChange,
    handleReset,
    handleSave,
  } = useGatewayConfigForm(t);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('system.config.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <p className="text-sm text-red-500">{t('system.config.load_error')}</p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">
              {t('system.config.api_base_url')}
            </label>
            <Input
              placeholder="https://api.example.com"
              value={form?.api_base_url ?? ''}
              onChange={handleChange('api_base_url')}
              disabled={disabled}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">
              {t('system.config.max_concurrent')}
            </label>
            <Input
              type="number"
              placeholder="1000"
              value={form?.max_concurrent_requests ?? ''}
              onChange={handleChange('max_concurrent_requests')}
              disabled={disabled}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">
              {t('system.config.request_timeout_ms')}
            </label>
            <Input
              type="number"
              placeholder="30000"
              value={form?.request_timeout_ms ?? ''}
              onChange={handleChange('request_timeout_ms')}
              disabled={disabled}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">
              {t('system.config.cache_ttl_seconds')}
            </label>
            <Input
              type="number"
              placeholder="3600"
              value={form?.cache_ttl_seconds ?? ''}
              onChange={handleChange('cache_ttl_seconds')}
              disabled={disabled}
            />
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">
            {t('system.config.probe_prompt')}
          </label>
          <Textarea
            rows={3}
            placeholder={t('system.config.probe_prompt_placeholder')}
            value={form?.probe_prompt ?? ''}
            onChange={handleChange('probe_prompt')}
            disabled={disabled}
          />
          <p className="text-xs text-muted-foreground">
            {t('system.config.probe_prompt_hint')}
          </p>
        </div>
        <div className="flex justify-end space-x-2 pt-4">
          <Button variant="outline" onClick={handleReset} disabled={disabled}>
            {t('system.config.reset')}
          </Button>
          <Button onClick={handleSave} disabled={disabled}>
            {saving ? t('system.config.saving') : t('system.config.save')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
