"use client";

import { useState } from 'react';
import { useI18n } from '@/lib/i18n-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Upload, Trash2 } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { useUpstreamProxyEndpoints, useUpstreamProxySources } from '@/lib/swr/use-upstream-proxy';
import { ImportDialog } from './import-dialog';
import { DeleteConfirmDialog } from './delete-confirm-dialog';
import type { UpstreamProxyEndpoint } from '@/lib/api-types';

/**
 * 代理条目管理表格
 */
export function UpstreamProxyEndpointsTable() {
  const { t } = useI18n();
  const [selectedSourceId, setSelectedSourceId] = useState<string>('__all__');
  const { sources = [] } = useUpstreamProxySources();
  const { endpoints = [], loading, error, update, remove } = useUpstreamProxyEndpoints(
    selectedSourceId === '__all__' ? undefined : selectedSourceId
  );
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingEndpoint, setDeletingEndpoint] = useState<UpstreamProxyEndpoint | null>(null);

  const handleToggleEnabled = async (endpoint: UpstreamProxyEndpoint) => {
    try {
      await update(endpoint.id, { enabled: !endpoint.enabled });
      toast.success(t('system.upstream_proxy.endpoints.update_success'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = (endpoint: UpstreamProxyEndpoint) => {
    setDeletingEndpoint(endpoint);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!deletingEndpoint) return;

    try {
      await remove(deletingEndpoint.id);
      toast.success(t('system.upstream_proxy.endpoints.delete_success'));
      setDeleteDialogOpen(false);
      setDeletingEndpoint(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
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
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg font-normal">
            {t('system.upstream_proxy.endpoints.title')}
          </CardTitle>
          <div className="flex gap-3 items-center">
            {/* 来源筛选 */}
            <Select value={selectedSourceId} onValueChange={setSelectedSourceId}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder={t('system.upstream_proxy.endpoints.all_sources')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">
                  {t('system.upstream_proxy.endpoints.all_sources')}
                </SelectItem>
                {sources.map((source) => (
                  <SelectItem key={source.id} value={source.id}>
                    {source.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button size="sm" onClick={() => setImportDialogOpen(true)}>
              <Upload className="h-4 w-4 mr-2" />
              {t('system.upstream_proxy.endpoints.import')}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('system.upstream_proxy.endpoints.scheme')}</TableHead>
                <TableHead>{t('system.upstream_proxy.endpoints.host')}</TableHead>
                <TableHead>{t('system.upstream_proxy.endpoints.port')}</TableHead>
                <TableHead>{t('system.upstream_proxy.endpoints.username')}</TableHead>
                <TableHead>{t('system.upstream_proxy.endpoints.enabled')}</TableHead>
                <TableHead>{t('system.upstream_proxy.endpoints.last_ok')}</TableHead>
                <TableHead>{t('system.upstream_proxy.endpoints.latency')}</TableHead>
                <TableHead>{t('system.upstream_proxy.endpoints.failures')}</TableHead>
                <TableHead>{t('system.upstream_proxy.endpoints.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground">
                    {t('common.loading')}
                  </TableCell>
                </TableRow>
              ) : endpoints.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground">
                    {t('common.no_data')}
                  </TableCell>
                </TableRow>
              ) : (
                endpoints.map((endpoint) => (
                  <TableRow key={endpoint.id}>
                    <TableCell>
                      <Badge variant="outline">{endpoint.scheme.toUpperCase()}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{endpoint.host}</TableCell>
                    <TableCell>{endpoint.port}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {endpoint.username || '-'}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={endpoint.enabled}
                        onCheckedChange={() => handleToggleEnabled(endpoint)}
                      />
                    </TableCell>
                    <TableCell>
                      {endpoint.last_ok === null ? (
                        <Badge variant="secondary">-</Badge>
                      ) : endpoint.last_ok ? (
                        <Badge variant="default">✓</Badge>
                      ) : (
                        <Badge variant="destructive">✗</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {endpoint.last_latency_ms !== null ? `${endpoint.last_latency_ms}` : '-'}
                    </TableCell>
                    <TableCell>
                      {endpoint.consecutive_failures > 0 ? (
                        <Badge variant="destructive">{endpoint.consecutive_failures}</Badge>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(endpoint)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        sources={sources}
      />

      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={confirmDelete}
        title={t('system.upstream_proxy.endpoints.delete')}
        description={t('system.upstream_proxy.endpoints.delete_confirm')}
      />
    </>
  );
}
