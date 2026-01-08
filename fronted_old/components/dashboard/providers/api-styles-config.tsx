"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { FormField } from "@/components/ui/form";

// 类型安全的FormField包装器
const SafeFormField = FormField as any;

interface ApiStylesConfigProps {
    form: any;
    isFieldOverridden: (fieldName: string) => boolean;
    markFieldAsOverridden: (fieldName: string) => void;
}

export function ApiStylesConfig({
    form,
    isFieldOverridden,
    markFieldAsOverridden
}: ApiStylesConfigProps) {
    return (
        <SafeFormField
            control={form.control}
            name="supportedApiStyles"
            render={({ field }: { field: any }) => (
                <div className="space-y-2">
                    <div className="flex items-center gap-2">
                        <label className="text-sm font-medium">API 请求格式</label>
                        {isFieldOverridden("supportedApiStyles") && (
                            <Badge variant="outline" className="text-xs">
                                已覆盖
                            </Badge>
                        )}
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">
                        选择提供商支持的请求/响应格式，用于正确解析和转换 API 调用
                    </p>
                    <div className="flex flex-wrap gap-4 pt-2">
                        {[
                            { value: "openai", label: "OpenAI", desc: "标准 OpenAI 格式" },
                            { value: "claude", label: "Claude", desc: "Anthropic Claude 格式" },
                            { value: "responses", label: "Responses", desc: "自定义响应格式" }
                        ].map((style) => (
                            <div key={style.value} className="flex items-start space-x-2">
                                <Checkbox
                                    id={`style-${style.value}`}
                                    checked={field.value?.includes(style.value) || false}
                                    onCheckedChange={(checked) => {
                                        const currentValue = field.value || [];
                                        const newValue = checked
                                            ? [...currentValue, style.value]
                                            : currentValue.filter((s: string) => s !== style.value);
                                        field.onChange(newValue);
                                        markFieldAsOverridden("supportedApiStyles");
                                    }}
                                    className="mt-1"
                                />
                                <div className="grid gap-1">
                                    <label
                                        htmlFor={`style-${style.value}`}
                                        className="text-sm font-medium cursor-pointer"
                                    >
                                        {style.label}
                                    </label>
                                    <p className="text-xs text-muted-foreground">
                                        {style.desc}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        />
    );
}