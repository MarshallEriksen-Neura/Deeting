'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useI18n } from '@/lib/i18n-context';
import { useProviderLimitsForm } from '@/lib/hooks/use-provider-limits-form';

/**
 * Provider 限制配置卡片组件
 * 负责显示和编辑 Provider 限制配置
 */
export function ProviderLimitsCard() {
  const { t } = useI18n();
  const {
    form,
    saving,
    error,
    disabled,
    handleChange,
    handleSwitchChange,
    handleReset,
    handleSave,
  } = useProviderLimitsForm(t);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('system.provider_limits.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <p className="text-sm text-red-500">
            {t('system.provider_limits.load_error')}
          </p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">
              {t('system.provider_limits.default_limit')}
            </label>
            <Input
              type="number"
              min={0}
              value={form?.default_user_private_provider_limit ?? ''}
              onChange={handleChange('default_user_private_provider_limit')}
              disabled={disabled}
            />
            <p className="text-xs text-muted-foreground">
              {t('system.provider_limits.default_hint')}
            </p>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">
              {t('system.provider_limits.max_limit')}
            </label>
            <Input
              type="number"
              min={0}
              value={form?.max_user_private_provider_limit ?? ''}
              onChange={handleChange('max_user_private_provider_limit')}
              disabled={disabled}
            />
            <p className="text-xs text-muted-foreground">
              {t('system.provider_limits.max_hint')}
            </p>
          </div>
        </div>
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">
              {t('system.provider_limits.require_approval')}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('system.provider_limits.require_approval_hint')}
            </p>
          </div>
          <Switch
            checked={form?.require_approval_for_shared_providers ?? false}
            onCheckedChange={handleSwitchChange}
            disabled={disabled}
          />
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
