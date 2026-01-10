"use client";

import { useState } from 'react';
import { useI18n } from '@/lib/i18n-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useUpstreamProxySources } from '@/lib/swr/use-upstream-proxy';
import { SourceDialog } from './source-dialog';
import { DeleteConfirmDialog } from './delete-confirm-dialog';
import type { UpstreamProxySource } from '@/lib/api-types';

/**
 * 代理来源管理表格
 */
export function UpstreamProxySourcesTable() {
  const { t } = useI18n();
  const { sources = [], loading, error, remove } = useUpstreamProxySources();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<UpstreamProxySource | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingSource, setDeletingSource] = useState<UpstreamProxySource | null>(null);

  const handleAdd = () => {
    setEditingSource(null);
    setDialogOpen(true);
  };

  const handleEdit = (source: UpstreamProxySource) => {
    setEditingSource(source);
    setDialogOpen(true);
  };

  const handleDelete = (source: UpstreamProxySource) => {
    setDeletingSource(source);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!deletingSource) return;
    
    try {
      await remove(deletingSource.id);
      toast.success(t('system.upstream_proxy.sources.delete_success'));
      setDeleteDialogOpen(false);
      setDeletingSource(null);
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
            {t('system.upstream_proxy.sources.title')}
          </CardTitle>
          <Button size="sm" onClick={handleAdd}>
            <Plus className="h-4 w-4 mr-2" />
            {t('system.upstream_proxy.sources.add')}
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('system.upstream_proxy.sources.name')}</TableHead>
                <TableHead>{t('system.upstream_proxy.sources.type')}</TableHead>
                <TableHead>{t('system.upstream_proxy.sources.enabled')}</TableHead>
                <TableHead>{t('system.upstream_proxy.sources.scheme')}</TableHead>
                <TableHead>{t('system.upstream_proxy.sources.refresh_interval')}</TableHead>
                <TableHead>{t('system.upstream_proxy.sources.last_refresh')}</TableHead>
                <TableHead>{t('system.upstream_proxy.sources.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    {t('common.loading')}
                  </TableCell>
                </TableRow>
              ) : sources.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    {t('common.no_data')}
                  </TableCell>
                </TableRow>
              ) : (
                sources && sources.map((source) => (
                  <TableRow key={source.id}>
                    <TableCell className="font-medium">{source.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {source.source_type === 'static_list'
                          ? t('system.upstream_proxy.sources.type_static')
                          : t('system.upstream_proxy.sources.type_remote')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {source.enabled ? (
                        <Badge variant="default">✓</Badge>
                      ) : (
                        <Badge variant="secondary">✗</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{source.default_scheme.toUpperCase()}</Badge>
                    </TableCell>
                    <TableCell>
                      {source.refresh_interval_seconds ?? '-'}
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <p className="text-sm">
                          {source.last_refresh_at
                            ? new Date(source.last_refresh_at).toLocaleString()
                            : '-'}
                        </p>
                        {source.last_refresh_error && (
                          <p className="text-xs text-red-600" title={source.last_refresh_error}>
                            {source.last_refresh_error.substring(0, 30)}...
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(source)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(source)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <SourceDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        source={editingSource}
      />

      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={confirmDelete}
        title={t('system.upstream_proxy.sources.delete')}
        description={t('system.upstream_proxy.sources.delete_confirm')}
      />
    </>
  );
}
