"use client";

import { useState, useEffect } from 'react';
import { useI18n } from '@/lib/i18n-context';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { useUpstreamProxySources } from '@/lib/swr/use-upstream-proxy';
import type { UpstreamProxySource, CreateUpstreamProxySourceRequest, UpstreamProxyScheme, UpstreamProxySourceType } from '@/lib/api-types';

interface SourceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source?: UpstreamProxySource | null;
}

/**
 * 代理来源创建/编辑对话框
 */
export function SourceDialog({ open, onOpenChange, source }: SourceDialogProps) {
  const { t } = useI18n();
  const { create, update, creating, updating } = useUpstreamProxySources();

  const [formData, setFormData] = useState<CreateUpstreamProxySourceRequest>({
    name: '',
    source_type: 'static_list',
    enabled: true,
    default_scheme: 'http',
    refresh_interval_seconds: 300,
    remote_url: '',
  });

  useEffect(() => {
    if (source) {
      setFormData({
        name: source.name,
        source_type: source.source_type,
        enabled: source.enabled,
        default_scheme: source.default_scheme,
        refresh_interval_seconds: source.refresh_interval_seconds ?? 300,
        remote_url: '',
      });
    } else {
      setFormData({
        name: '',
        source_type: 'static_list',
        enabled: true,
        default_scheme: 'http',
        refresh_interval_seconds: 300,
        remote_url: '',
      });
    }
  }, [source, open]);

  const handleSubmit = async () => {
    try {
      if (source) {
        await update(source.id, formData);
        toast.success(t('system.upstream_proxy.sources.update_success'));
      } else {
        await create(formData);
        toast.success(t('system.upstream_proxy.sources.create_success'));
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const isRemote = formData.source_type === 'remote_text_list';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {source
              ? t('system.upstream_proxy.sources.edit')
              : t('system.upstream_proxy.sources.add')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* 名称 */}
          <div className="space-y-2">
            <Label htmlFor="name">{t('system.upstream_proxy.sources.name')}</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </div>

          {/* 类型 */}
          <div className="space-y-2">
            <Label htmlFor="source_type">{t('system.upstream_proxy.sources.type')}</Label>
            <Select
              value={formData.source_type}
              onValueChange={(value: UpstreamProxySourceType) =>
                setFormData({ ...formData, source_type: value })
              }
              disabled={!!source}
            >
              <SelectTrigger id="source_type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="static_list">
                  {t('system.upstream_proxy.sources.type_static')}
                </SelectItem>
                <SelectItem value="remote_text_list">
                  {t('system.upstream_proxy.sources.type_remote')}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* 默认协议 */}
          <div className="space-y-2">
            <Label htmlFor="default_scheme">{t('system.upstream_proxy.sources.scheme')}</Label>
            <Select
              value={formData.default_scheme}
              onValueChange={(value: UpstreamProxyScheme) =>
                setFormData({ ...formData, default_scheme: value })
              }
            >
              <SelectTrigger id="default_scheme">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="http">HTTP</SelectItem>
                <SelectItem value="https">HTTPS</SelectItem>
                <SelectItem value="socks5">SOCKS5</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* 远程 URL（仅远程类型） */}
          {isRemote && (
            <>
              <div className="space-y-2">
                <Label htmlFor="remote_url">{t('system.upstream_proxy.sources.remote_url')}</Label>
                <Input
                  id="remote_url"
                  value={formData.remote_url}
                  onChange={(e) => setFormData({ ...formData, remote_url: e.target.value })}
                  placeholder="https://example.com/proxy-list.txt"
                />
                <p className="text-xs text-muted-foreground">
                  {t('system.upstream_proxy.sources.remote_url_hint')}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="refresh_interval">
                  {t('system.upstream_proxy.sources.refresh_interval')}
                </Label>
                <Input
                  id="refresh_interval"
                  type="number"
                  value={formData.refresh_interval_seconds}
                  onChange={(e) =>
                    setFormData({ ...formData, refresh_interval_seconds: parseInt(e.target.value) })
                  }
                />
              </div>
            </>
          )}

          {/* 启用开关 */}
          <div className="flex items-center justify-between">
            <Label>{t('system.upstream_proxy.sources.enabled')}</Label>
            <Switch
              checked={formData.enabled}
              onCheckedChange={(checked) => setFormData({ ...formData, enabled: checked })}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={creating || updating}>
            {creating || updating ? t('common.saving') : t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
