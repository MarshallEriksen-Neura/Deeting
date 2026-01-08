"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { ProvidersTableEnhanced } from "@/components/dashboard/providers/providers-table-enhanced";
import { ProviderFormEnhanced } from "@/components/dashboard/providers/provider-form";
import { ProviderModelsDialog } from "@/components/dashboard/providers/provider-models-dialog";
import { Provider, providerService } from "@/http/provider";
import { useI18n } from "@/lib/i18n-context";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuthStore } from "@/lib/stores/auth-store";

interface ProvidersPageClientProps {
  initialPrivateProviders: Provider[];
  initialSharedProviders: Provider[];
  initialPublicProviders: Provider[];
  userId: string | null;
}

export function ProvidersPageClient({
  initialPrivateProviders,
  initialSharedProviders,
  initialPublicProviders,
  userId,
}: ProvidersPageClientProps) {
  const { t } = useI18n();
  const router = useRouter();
  const authUserId = useAuthStore((state) => state.user?.id ?? null);
  const effectiveUserId = userId ?? authUserId;
  
  // 表单和对话框状态
  const [formOpen, setFormOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [modelsDialogOpen, setModelsDialogOpen] = useState(false);
  const [modelsProviderId, setModelsProviderId] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletingProviderId, setDeletingProviderId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  
  // 筛选器状态
  const [searchQuery, setSearchQuery] = useState("");
  const [visibilityFilter, setVisibilityFilter] = useState<'all' | 'private' | 'public' | 'shared'>('all');

  // 提供商数据状态
  const [privateProviders, setPrivateProviders] = useState<Provider[]>(initialPrivateProviders);
  const [sharedProviders, setSharedProviders] = useState<Provider[]>(initialSharedProviders);
  const [publicProviders, setPublicProviders] = useState<Provider[]>(initialPublicProviders);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  // 模型管理状态
  const [modelsPathByProvider, setModelsPathByProvider] = useState<Record<string, string>>({});

  // 刷新提供商列表
  const refresh = useCallback(async () => {
    if (!effectiveUserId) return;
    
    setIsRefreshing(true);
    try {
      const response = await providerService.getUserAvailableProviders(
        effectiveUserId,
        visibilityFilter === 'all' ? undefined : visibilityFilter
      );
      setPrivateProviders(response.private_providers);
      setSharedProviders(response.shared_providers ?? []);
      setPublicProviders(response.public_providers);
    } catch (error) {
      console.error("Failed to refresh providers:", error);
      toast.error(t("providers.error_loading"));
    } finally {
      setIsRefreshing(false);
    }
  }, [effectiveUserId, visibilityFilter, t]);

  // 首次加载时，根据登录用户自动拉取可用 Provider 列表
  useEffect(() => {
    if (!effectiveUserId || hasLoadedOnce) return;

    const load = async () => {
      setIsRefreshing(true);
      try {
        const response = await providerService.getUserAvailableProviders(
          effectiveUserId,
          visibilityFilter === "all" ? undefined : visibilityFilter,
        );
        setPrivateProviders(response.private_providers);
        setSharedProviders(response.shared_providers ?? []);
        setPublicProviders(response.public_providers);
      } catch (error) {
        console.error("Failed to load providers on mount:", error);
        toast.error(t("providers.error_loading"));
      } finally {
        setIsRefreshing(false);
        setHasLoadedOnce(true);
      }
    };

    load();
  }, [effectiveUserId, hasLoadedOnce, visibilityFilter, t]);

  // 本地搜索过滤（优化：使用 useMemo）
  const filteredPrivateProviders = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return privateProviders;

    return privateProviders.filter((provider) => {
      const name = provider.name?.toLowerCase() ?? "";
      const providerId = provider.provider_id?.toLowerCase() ?? "";
      const baseUrl = provider.base_url?.toLowerCase() ?? "";

      return (
        name.includes(query) ||
        providerId.includes(query) ||
        baseUrl.includes(query)
      );
    });
  }, [privateProviders, searchQuery]);

  const filteredSharedProviders = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return sharedProviders;

    return sharedProviders.filter((provider) => {
      const name = provider.name?.toLowerCase() ?? "";
      const providerId = provider.provider_id?.toLowerCase() ?? "";
      const baseUrl = provider.base_url?.toLowerCase() ?? "";

      return (
        name.includes(query) ||
        providerId.includes(query) ||
        baseUrl.includes(query)
      );
    });
  }, [sharedProviders, searchQuery]);

  const filteredPublicProviders = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return publicProviders;

    return publicProviders.filter((provider) => {
      const name = provider.name?.toLowerCase() ?? "";
      const providerId = provider.provider_id?.toLowerCase() ?? "";
      const baseUrl = provider.base_url?.toLowerCase() ?? "";

      return (
        name.includes(query) ||
        providerId.includes(query) ||
        baseUrl.includes(query)
      );
    });
  }, [publicProviders, searchQuery]);

  // 打开创建表单（优化：使用 useCallback）
  const handleCreate = useCallback(() => {
    // 新建时清空当前编辑对象
    setEditingProvider(null);
    setFormOpen(true);
  }, []);

  // 表单成功回调（优化：使用 useCallback）
  const handleFormSuccess = useCallback(() => {
    refresh();
    // 提交成功后重置编辑状态
    setEditingProvider(null);
  }, [refresh]);

  // 编辑提供商（优化：使用 useCallback）
  const handleEdit = useCallback((provider: Provider) => {
    // 打开编辑表单并填充数据
    setEditingProvider(provider);
    setFormOpen(true);
  }, []);

  // 打开删除确认（优化：使用 useCallback）
  const handleDeleteClick = useCallback((providerId: string) => {
    setDeletingProviderId(providerId);
    setDeleteConfirmOpen(true);
  }, []);

  // 确认删除（优化：使用 useCallback）
  const handleDeleteConfirm = useCallback(async () => {
    if (!deletingProviderId || !effectiveUserId) return;

    setIsDeleting(true);
    try {
      await providerService.deletePrivateProvider(effectiveUserId, deletingProviderId);
      toast.success(t("providers.toast_delete_success"));
      await refresh();
    } catch (error: any) {
      console.error(t("providers.toast_delete_error"), error);
      const message = error.response?.data?.detail || error.message || t("providers.toast_delete_error");
      toast.error(message);
    } finally {
      setIsDeleting(false);
      setDeleteConfirmOpen(false);
      setDeletingProviderId(null);
    }
  }, [deletingProviderId, effectiveUserId, refresh, t]);

  // 查看详情（优化：使用 useCallback）
  const handleViewDetails = useCallback((providerId: string) => {
    // 使用 Next.js 原生路由跳转到 Provider 详情页
    router.push(`/dashboard/providers/${providerId}`);
  }, [router]);

  // 模型管理回调（优化：使用 useCallback）
  const handleViewModels = useCallback((providerId: string) => {
    setModelsProviderId(providerId);
    setModelsDialogOpen(true);
  }, []);

  const handleModelsPathChange = useCallback((providerId: string, path: string) => {
    setModelsPathByProvider((prev) => ({
      ...prev,
      [providerId]: path,
    }));
  }, []);



  return (
    <div className="space-y-6 max-w-7xl">
      {/* 页面标题、筛选器和操作按钮 */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold">{t("providers.directory_title")}</h1>
          <p className="text-muted-foreground text-sm">
            {t("providers.directory_subtitle")}
          </p>
        </div>
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          {/* 可见性筛选器 */}
          <Select
            value={visibilityFilter}
            onValueChange={(value: any) => setVisibilityFilter(value)}
          >
            <SelectTrigger className="w-full md:w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("providers.filter_all")}</SelectItem>
              <SelectItem value="private">{t("providers.filter_private")}</SelectItem>
              <SelectItem value="shared">{t("providers.filter_shared")}</SelectItem>
              <SelectItem value="public">{t("providers.filter_public")}</SelectItem>
            </SelectContent>
          </Select>

          {/* 搜索框 */}
          <div className="relative w-full md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t("providers.search_placeholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* 添加按钮 */}
          <Button onClick={handleCreate} className="md:ml-2">
            <Plus className="w-4 h-4 mr-2" />
            {t("providers.add_provider")}
          </Button>
        </div>
      </div>

      {/* 提供商列表表格 */}
      <ProvidersTableEnhanced
        privateProviders={filteredPrivateProviders}
        sharedProviders={filteredSharedProviders}
        publicProviders={filteredPublicProviders}
        isLoading={isRefreshing}
        onEdit={handleEdit}
        onDelete={handleDeleteClick}
        onViewDetails={handleViewDetails}
        onViewModels={handleViewModels}
        currentUserId={effectiveUserId ?? undefined}
      />

      {/* 创建/编辑表单抽屉 */}
      <ProviderFormEnhanced
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) {
            setEditingProvider(null);
          }
        }}
        onSuccess={handleFormSuccess}
        editingProvider={editingProvider ?? undefined}
      />

      {/* 模型管理抽屉 */}
      <ProviderModelsDialog
        open={modelsDialogOpen}
        onOpenChange={setModelsDialogOpen}
        providerId={modelsProviderId}
        modelsPathByProvider={modelsPathByProvider}
        onModelsPathChange={handleModelsPathChange}
      />

      {/* 删除确认抽屉 */}
      <Drawer open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DrawerContent className="mx-auto w-full max-w-md">
          <DrawerHeader>
            <DrawerTitle>{t("providers.delete_dialog_title")}</DrawerTitle>
            <DrawerDescription>
              {t("providers.delete_dialog_description")}{" "}
              <span className="font-mono font-semibold">{deletingProviderId}</span>
              {t("providers.delete_dialog_warning")}
            </DrawerDescription>
          </DrawerHeader>
          <DrawerFooter className="border-t bg-background/80 backdrop-blur">
            <div className="flex w-full justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setDeleteConfirmOpen(false)}
                disabled={isDeleting}
              >
                {t("providers.btn_cancel")}
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeleteConfirm}
                disabled={isDeleting}
              >
                {isDeleting
                  ? t("providers.deleting_button")
                  : t("providers.delete_button")}
              </Button>
            </div>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
