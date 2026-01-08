"use client";

import React, { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Plus, X, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

interface ArrayEditorProps {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  description?: string;
  disabled?: boolean;
  error?: string;
  itemValidator?: (item: string) => boolean;
  itemPlaceholder?: string;
}

export function ArrayEditor({
  label,
  value = [],
  onChange,
  description,
  disabled = false,
  error,
  itemValidator,
  itemPlaceholder = "输入值",
}: ArrayEditorProps) {
  const [newItem, setNewItem] = useState("");
  const [itemError, setItemError] = useState<string | null>(null);

  const handleAddItem = () => {
    const trimmed = newItem.trim();
    if (!trimmed) {
      setItemError("值不能为空");
      return;
    }

    if (value.includes(trimmed)) {
      setItemError("该值已存在");
      return;
    }

    if (itemValidator && !itemValidator(trimmed)) {
      setItemError("值格式无效");
      return;
    }

    onChange([...value, trimmed]);
    setNewItem("");
    setItemError(null);
  };

  const handleRemoveItem = (index: number) => {
    const newValue = value.filter((_, i) => i !== index);
    onChange(newValue);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddItem();
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">{label}</Label>
        <Badge variant="outline" className="text-xs">
          {value.length} 项
        </Badge>
      </div>

      {/* 现有项目列表 */}
      {value.length > 0 && (
        <div className="space-y-2 max-h-48 overflow-y-auto border rounded-md p-2 bg-muted/20">
          {value.map((item, index) => (
            <div
              key={index}
              className="flex items-center gap-2 p-2 rounded-md bg-background border"
            >
              <GripVertical className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <span className="flex-1 text-sm truncate">{item}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleRemoveItem(index)}
                disabled={disabled}
                className="h-7 w-7 p-0"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* 添加新项目 */}
      <div className="flex gap-2">
        <Input
          type="text"
          value={newItem}
          onChange={(e) => {
            setNewItem(e.target.value);
            setItemError(null);
          }}
          onKeyPress={handleKeyPress}
          placeholder={itemPlaceholder}
          disabled={disabled}
          className={cn(itemError && "border-destructive")}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleAddItem}
          disabled={disabled || !newItem.trim()}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {itemError && (
        <p className="text-xs text-destructive">{itemError}</p>
      )}

      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}

      {description && !itemError && !error && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
    </div>
  );
}

// 数字数组编辑器（用于状态码）
interface NumberArrayEditorProps {
  label: string;
  value: number[];
  onChange: (value: number[]) => void;
  placeholder?: string;
  description?: string;
  disabled?: boolean;
  error?: string;
  min?: number;
  max?: number;
}

export function NumberArrayEditor({
  label,
  value = [],
  onChange,
  placeholder = "添加数字",
  description,
  disabled = false,
  error,
  min,
  max,
}: NumberArrayEditorProps) {
  const [newItem, setNewItem] = useState("");
  const [itemError, setItemError] = useState<string | null>(null);

  const handleAddItem = () => {
    const trimmed = newItem.trim();
    if (!trimmed) {
      setItemError("值不能为空");
      return;
    }

    const num = Number(trimmed);
    if (isNaN(num)) {
      setItemError("请输入有效的数字");
      return;
    }

    if (min !== undefined && num < min) {
      setItemError(`值不能小于 ${min}`);
      return;
    }

    if (max !== undefined && num > max) {
      setItemError(`值不能大于 ${max}`);
      return;
    }

    if (value.includes(num)) {
      setItemError("该值已存在");
      return;
    }

    onChange([...value, num]);
    setNewItem("");
    setItemError(null);
  };

  const handleRemoveItem = (index: number) => {
    const newValue = value.filter((_, i) => i !== index);
    onChange(newValue);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddItem();
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">{label}</Label>
        <Badge variant="outline" className="text-xs">
          {value.length} 项
        </Badge>
      </div>

      {/* 现有项目列表 */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map((item, index) => (
            <Badge
              key={index}
              variant="secondary"
              className="pl-2 pr-1 py-1 text-sm"
            >
              {item}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleRemoveItem(index)}
                disabled={disabled}
                className="h-4 w-4 p-0 ml-1 hover:bg-transparent"
              >
                <X className="h-3 w-3" />
              </Button>
            </Badge>
          ))}
        </div>
      )}

      {/* 添加新项目 */}
      <div className="flex gap-2">
        <Input
          type="number"
          value={newItem}
          onChange={(e) => {
            setNewItem(e.target.value);
            setItemError(null);
          }}
          onKeyPress={handleKeyPress}
          placeholder={placeholder}
          disabled={disabled}
          min={min}
          max={max}
          className={cn(itemError && "border-destructive")}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleAddItem}
          disabled={disabled || !newItem.trim()}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {itemError && (
        <p className="text-xs text-destructive">{itemError}</p>
      )}

      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}

      {description && !itemError && !error && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
    </div>
  );
}
