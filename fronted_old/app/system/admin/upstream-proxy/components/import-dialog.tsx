"use client";

import { useState } from 'react';
import { useI18n } from '@/lib/i18n-context';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { useUpstreamProxyEndpoints } from '@/lib/swr/use-upstream-proxy';
import type { UpstreamProxySource, UpstreamProxyScheme } from '@/lib/api-types';

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sources: UpstreamProxySource[];
}

/**
 * 批量导入代理条目对话框
 */
export function ImportDialog({ open, onOpenChange, sources = [] }: ImportDialogProps) {
  const { t } = useI18n();
  const { importEndpoints, importing } = useUpstreamProxyEndpoints();

  const [sourceId, setSourceId] = useState('');
  const [defaultScheme, setDefaultScheme] = useState<UpstreamProxyScheme>('http');
  const [text, setText] = useState('');

  const handleSubmit = async () => {
    if (!sourceId) {
      toast.error(t('common.required_field'));
      return;
    }

    if (!text.trim()) {
      toast.error(t('common.required_field'));
      return;
    }

    try {
      const result = await importEndpoints({
        source_id: sourceId,
        default_scheme: defaultScheme,
        text: text.trim(),
      });
      toast.success(
        t('system.upstream_proxy.endpoints.import_success').replace(
          '{count}',
          result.inserted_or_updated.toString()
        )
      );
      onOpenChange(false);
      setText('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('system.upstream_proxy.endpoints.import')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* 选择来源 */}
          <div className="space-y-2">
            <Label htmlFor="source_id">{t('system.upstream_proxy.endpoints.filter_source')}</Label>
            <Select value={sourceId} onValueChange={setSourceId}>
              <SelectTrigger id="source_id">
                <SelectValue placeholder={t('common.select')} />
              </SelectTrigger>
              <SelectContent>
                {sources.map((source) => (
                  <SelectItem key={source.id} value={source.id}>
                    {source.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 默认协议 */}
          <div className="space-y-2">
            <Label htmlFor="default_scheme">{t('system.upstream_proxy.sources.scheme')}</Label>
            <Select
              value={defaultScheme}
              onValueChange={(value: UpstreamProxyScheme) => setDefaultScheme(value)}
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

          {/* 代理列表文本 */}
          <div className="space-y-2">
            <Label htmlFor="text">{t('system.upstream_proxy.endpoints.import_text')}</Label>
            <Textarea
              id="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="142.111.48.253:7030:user:pass&#10;http://1.2.3.4:8080&#10;socks5://5.6.7.8:1080"
              rows={10}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              {t('system.upstream_proxy.endpoints.import_hint')}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={importing}>
            {importing ? t('common.saving') : t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
