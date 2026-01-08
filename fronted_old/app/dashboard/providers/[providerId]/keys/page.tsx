"use client";

import { useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Plus, ArrowLeft } from "lucide-react";
import { useI18n } from "@/lib/i18n-context";
import { useProviderKeys } from "@/lib/swr/use-provider-keys";
import { providerKeyService } from "@/http/provider-keys";
import { ProviderKeysTable } from "@/components/dashboard/provider-keys/provider-keys-table";
import { ProviderKeyDialog } from "@/components/dashboard/provider-keys/provider-key-dialog";
import { DeleteKeyDialog } from "@/components/dashboard/provider-keys/delete-key-dialog";
import { toast } from "sonner";
import type { ProviderKey, CreateProviderKeyRequest, UpdateProviderKeyRequest } from "@/lib/api-types";
import { useErrorDisplay } from "@/lib/errors";

export default function ProviderKeysPage() {
  const { t } = useI18n();
  const { showError } = useErrorDisplay();
  const router = useRouter();
  const params = useParams();
  const providerId = params.providerId as string;

  // 数据获取
  const { keys, isLoading, mutate } = useProviderKeys(providerId);

  // 抽屉状态
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<ProviderKey | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingKey, setDeletingKey] = useState<ProviderKey | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // 打开创建抽屉
  const handleCreate = useCallback(() => {
    setEditingKey(null);
    setDialogOpen(true);
  }, []);

  // 打开编辑抽屉
  const handleEdit = useCallback((key: ProviderKey) => {
    setEditingKey(key);
    setDialogOpen(true);
  }, []);

  // 打开删除确认抽屉
  const handleDelete = useCallback((keyId: string) => {
    const key = keys.find(k => k.id === keyId);
    if (key) {
      setDeletingKey(key);
      setDeleteDialogOpen(true);
    }
  }, [keys]);

  // 提交表单（创建或编辑）
  const handleSubmit = useCallback(async (data: CreateProviderKeyRequest | UpdateProviderKeyRequest) => {
    try {
      if (editingKey) {
        // 编辑
        await providerKeyService.updateKey(providerId, editingKey.id, data as UpdateProviderKeyRequest);
        toast.success(t("provider_keys.toast_update_success"));
      } else {
        // 创建
        await providerKeyService.createKey(providerId, data as CreateProviderKeyRequest);
        toast.success(t("provider_keys.toast_create_success"));
      }
      mutate(); // 刷新列表
    } catch (error) {
      showError(error, {
        context: editingKey
          ? t("provider_keys.toast_update_error")
          : t("provider_keys.toast_create_error"),
        onRetry: () => handleSubmit(data),
      });
      throw error;
    }
  }, [editingKey, providerId, mutate, t, showError]);

  // 确认删除
  const handleConfirmDelete = useCallback(async () => {
    if (!deletingKey) return;

    setIsDeleting(true);
    try {
      await providerKeyService.deleteKey(providerId, deletingKey.id);
      toast.success(t("provider_keys.toast_delete_success"));
      mutate(); // 刷新列表
      setDeleteDialogOpen(false);
      setDeletingKey(null);
    } catch (error) {
      showError(error, {
        context: t("provider_keys.toast_delete_error"),
        onRetry: handleConfirmDelete,
      });
    } finally {
      setIsDeleting(false);
    }
  }, [deletingKey, providerId, mutate, t, showError]);

  const handleSuccess = useCallback(() => {
    // 抽屉关闭后的回调
  }, []);

  return (
    <div className="container mx-auto py-8 space-y-6">
      {/* 页面头部 */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.back()}
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <h1 className="text-3xl font-bold tracking-tight">
              {t("provider_keys.title")}
            </h1>
          </div>
          <p className="text-muted-foreground">
            {t("provider_keys.subtitle")}
          </p>
        </div>
        <Button onClick={handleCreate}>
          <Plus className="w-4 h-4 mr-2" />
          {t("provider_keys.add_key")}
        </Button>
      </div>

      {/* 密钥列表表格 */}
      <ProviderKeysTable
        keys={keys}
        loading={isLoading}
        onEdit={handleEdit}
        onDelete={handleDelete}
      />

      {/* 创建/编辑抽屉 */}
      <ProviderKeyDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editingKey={editingKey}
        onSuccess={handleSuccess}
        onSubmit={handleSubmit}
      />

      {/* 删除确认抽屉 */}
      {deletingKey && (
        <DeleteKeyDialog
          open={deleteDialogOpen}
          onOpenChange={setDeleteDialogOpen}
          keyLabel={deletingKey.label}
          onConfirm={handleConfirmDelete}
          isDeleting={isDeleting}
        />
      )}
    </div>
  );
}
