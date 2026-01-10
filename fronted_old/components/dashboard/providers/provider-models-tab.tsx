"use client";

import { useMemo, useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Layers, Search, X } from "lucide-react";
import type { ModelsResponse, Model } from "@/http/provider";
import { ModelCard } from "./model-card";
import { ALL_MODEL_CAPABILITIES, CAPABILITY_META, type ModelCapabilityValue, normalize_capabilities } from "./model-capabilities";

interface ProviderModelsTabProps {
  providerId: string;
  models?: ModelsResponse;
  selectedModelId?: string | null;
  canEdit: boolean;
  onOpenSettings: (model: Model) => void;
  onRefresh: () => Promise<void>;
  translations: {
    title: string;
    description: string;
    noModels: string;
    countUnit?: string;
    countUnitSingular?: string;
    countUnitPlural?: string;
    searchPlaceholder?: string;
    filterByCapability?: string;
    clearFilters?: string;
    noMatchingModels?: string;
    showingCount?: string;
  };
  capabilityLabels?: Record<ModelCapabilityValue, string>;
}

export const ProviderModelsTab = ({
  providerId,
  models,
  selectedModelId,
  canEdit,
  onOpenSettings,
  onRefresh,
  translations,
  capabilityLabels
}: ProviderModelsTabProps) => {
  const modelCount = models?.models?.length || 0;
  const [localSelectedModelId, setLocalSelectedModelId] = useState<string | null>(null);
  const effectiveSelectedModelId = selectedModelId ?? localSelectedModelId;

  // 搜索和筛选状态
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCapabilities, setSelectedCapabilities] = useState<Set<ModelCapabilityValue>>(new Set());

  // 切换能力筛选
  const toggleCapability = useCallback((cap: ModelCapabilityValue) => {
    setSelectedCapabilities(prev => {
      const newSet = new Set(prev);
      if (newSet.has(cap)) {
        newSet.delete(cap);
      } else {
        newSet.add(cap);
      }
      return newSet;
    });
  }, []);

  // 清除所有筛选
  const clearFilters = useCallback(() => {
    setSearchQuery("");
    setSelectedCapabilities(new Set());
  }, []);

  // 获取此提供商所有模型拥有的能力集合
  const availableCapabilities = useMemo(() => {
    const caps = new Set<ModelCapabilityValue>();
    models?.models?.forEach(model => {
      normalize_capabilities(model.capabilities).forEach(cap => caps.add(cap));
    });
    return ALL_MODEL_CAPABILITIES.filter(cap => caps.has(cap));
  }, [models?.models]);

  // 筛选后的模型列表
  const filteredModels = useMemo(() => {
    if (!models?.models) return [];

    return models.models.filter(model => {
      // 搜索过滤：匹配模型ID、显示名称、别名
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchId = model.model_id.toLowerCase().includes(query);
        const matchName = model.display_name?.toLowerCase().includes(query);
        const matchAlias = model.alias?.toLowerCase().includes(query);
        const matchFamily = model.family?.toLowerCase().includes(query);
        if (!matchId && !matchName && !matchAlias && !matchFamily) {
          return false;
        }
      }

      // 能力过滤：模型必须包含所有选中的能力
      if (selectedCapabilities.size > 0) {
        const modelCaps = normalize_capabilities(model.capabilities);
        for (const cap of selectedCapabilities) {
          if (!modelCaps.includes(cap)) {
            return false;
          }
        }
      }

      return true;
    });
  }, [models?.models, searchQuery, selectedCapabilities]);

  const filteredCount = filteredModels.length;
  const hasFilters = searchQuery.trim() !== "" || selectedCapabilities.size > 0;

  const countLabel =
    modelCount === 0
      ? ""
      : translations.countUnit ||
        (modelCount === 1
          ? translations.countUnitSingular || "model"
          : translations.countUnitPlural || "models");

  // 按模型 ID 的前缀（以 "/" 分隔）分组 - 使用筛选后的模型
  const groupedModels = useMemo(() => {
    if (filteredModels.length === 0) return {};

    const groups: Record<string, Model[]> = {};
    filteredModels.forEach((model) => {
      const modelId = model.model_id || "";
      const groupKey: string = modelId.includes("/")
        ? (modelId.split("/")[0] || "other")
        : (model.family || "other");
      if (!groups[groupKey]) {
        groups[groupKey] = [];
      }
      groups[groupKey].push(model);
    });

    // 按分组名称排序
    return Object.keys(groups)
      .sort()
      .reduce((acc, key) => {
        acc[key] = groups[key]!;
        return acc;
      }, {} as Record<string, Model[]>);
  }, [filteredModels]);
  
  return (
    <div className="space-y-6">
      {/* 标题区域 */}
      <div className="flex items-start gap-4">
        <div className="p-3 rounded-xl bg-primary/10 text-primary">
          <Layers className="h-6 w-6" />
        </div>
        <div className="flex-1">
          <h2 className="text-2xl font-bold tracking-tight mb-1">
            {translations.title}
          </h2>
          <p className="text-muted-foreground">
            {translations.description}
            {modelCount > 0 && (
              <span className="ml-2 text-primary font-medium">
                • {modelCount} {countLabel}
              </span>
            )}
          </p>
        </div>
      </div>

      {/* 搜索和筛选区域 - 仅在有模型时显示 */}
      {modelCount > 0 && (
        <div className="space-y-4">
          {/* 搜索框 */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder={translations.searchPlaceholder || "Search models..."}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-10"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* 能力筛选标签 */}
          {availableCapabilities.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {translations.filterByCapability || "Filter by capability:"}
              </span>
              {availableCapabilities.map((cap) => {
                const meta = CAPABILITY_META[cap];
                const Icon = meta.icon;
                const isSelected = selectedCapabilities.has(cap);
                const label = capabilityLabels?.[cap] || cap;
                return (
                  <Badge
                    key={cap}
                    variant={isSelected ? "default" : "outline"}
                    className="cursor-pointer select-none gap-1.5 transition-colors"
                    onClick={() => toggleCapability(cap)}
                  >
                    <Icon className="h-3 w-3" />
                    {label}
                  </Badge>
                );
              })}
              {hasFilters && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-2"
                >
                  {translations.clearFilters || "Clear filters"}
                </button>
              )}
            </div>
          )}

          {/* 筛选结果统计 */}
          {hasFilters && (
            <p className="text-sm text-muted-foreground">
              {translations.showingCount
                ? translations.showingCount.replace("{count}", String(filteredCount)).replace("{total}", String(modelCount))
                : `Showing ${filteredCount} of ${modelCount} models`}
            </p>
          )}
        </div>
      )}

      {/* 模型卡片网格 - 按前缀分组 */}
      {!models?.models || models.models.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="p-4 rounded-full bg-muted mb-4">
              <Layers className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground text-center">
              {translations.noModels}
            </p>
          </CardContent>
        </Card>
      ) : filteredCount === 0 && hasFilters ? (
        // 有筛选条件但无匹配结果
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="p-4 rounded-full bg-muted mb-4">
              <Search className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground text-center mb-4">
              {translations.noMatchingModels || "No models match your filters"}
            </p>
            <button
              type="button"
              onClick={clearFilters}
              className="text-sm text-primary hover:underline"
            >
              {translations.clearFilters || "Clear filters"}
            </button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {Object.entries(groupedModels).map(([groupName, groupModels]) => (
            <div key={groupName} className="space-y-4">
              {/* 分组标题 */}
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider px-3 py-1 bg-muted/50 rounded-full">
                  {groupName}
                  <span className="ml-2 text-xs font-normal text-muted-foreground/70">
                    ({groupModels.length})
                  </span>
                </h3>
                <div className="h-px flex-1 bg-border" />
              </div>
              
              {/* 该分组下的模型卡片 */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {groupModels.map((model) => (
                  <ModelCard
                    key={model.model_id}
                    providerId={providerId}
                    model={model}
                    selected={Boolean(effectiveSelectedModelId && effectiveSelectedModelId === model.model_id)}
                    canEdit={canEdit}
                    onOpenSettings={() => {
                      setLocalSelectedModelId(model.model_id);
                      onOpenSettings(model);
                    }}
                    onRefresh={onRefresh}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
