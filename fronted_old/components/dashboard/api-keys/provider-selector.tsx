"use client";

import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { useProviders } from "@/lib/swr/use-api-keys";

interface ProviderSelectorProps {
    value: string[];
    onChange: (value: string[]) => void;
    disabled?: boolean;
}

export function ProviderSelector({
    value,
    onChange,
    disabled = false,
}: ProviderSelectorProps) {
    const { providers, loading } = useProviders();

    const handleSelect = (providerId: string) => {
        if (!value.includes(providerId)) {
            onChange([...value, providerId]);
        }
    };

    const handleRemove = (providerId: string) => {
        onChange(value.filter(id => id !== providerId));
    };

    const handleClearAll = () => {
        onChange([]);
    };

    const getProviderName = (providerId: string) => {
        const provider = providers.find(p => p.id === providerId);
        return provider?.name || providerId;
    };

    const availableProviders = providers.filter(p => !value.includes(p.id));

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <label className="text-sm font-medium">
                    允许的提供商
                    <span className="text-muted-foreground ml-2">(可选)</span>
                </label>
                {value.length > 0 && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleClearAll}
                        disabled={disabled}
                    >
                        清除全部
                    </Button>
                )}
            </div>

            <Select
                onValueChange={handleSelect}
                disabled={disabled || loading}
            >
                <SelectTrigger>
                    <SelectValue placeholder={
                        loading 
                            ? "加载中..." 
                            : value.length === 0 
                                ? "选择提供商（留空表示无限制）" 
                                : `已选择 ${value.length} 个提供商`
                    } />
                </SelectTrigger>
                <SelectContent>
                    {availableProviders.length === 0 ? (
                        <div className="p-2 text-sm text-muted-foreground text-center">
                            {value.length > 0 ? "所有提供商已选择" : "暂无可用提供商"}
                        </div>
                    ) : (
                        availableProviders.map((provider) => (
                            <SelectItem key={provider.id} value={provider.id}>
                                <div className="flex items-center gap-2">
                                    <span>{provider.name}</span>
                                    <span className="text-xs text-muted-foreground">
                                        ({provider.id})
                                    </span>
                                </div>
                            </SelectItem>
                        ))
                    )}
                </SelectContent>
            </Select>

            {value.length > 0 && (
                <div className="flex flex-wrap gap-2">
                    {value.map((providerId) => (
                        <Badge
                            key={providerId}
                            variant="secondary"
                            className="pl-2 pr-1 py-1"
                        >
                            <span className="text-sm">{getProviderName(providerId)}</span>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-4 w-4 p-0 ml-1 hover:bg-transparent"
                                onClick={() => handleRemove(providerId)}
                                disabled={disabled}
                            >
                                <X className="h-3 w-3" />
                            </Button>
                        </Badge>
                    ))}
                </div>
            )}

            <p className="text-xs text-muted-foreground">
                {value.length === 0 
                    ? "不选择任何提供商表示此 API Key 可以访问所有提供商" 
                    : `此 API Key 只能访问选中的 ${value.length} 个提供商`
                }
            </p>
        </div>
    );
}
