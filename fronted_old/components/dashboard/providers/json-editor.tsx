"use client";

import { useState, useEffect } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface JsonEditorProps {
  label: string;
  value: any;
  onChange: (value: any) => void;
  placeholder?: string;
  description?: string;
  disabled?: boolean;
  error?: string;
  rows?: number;
}

export function JsonEditor({
  label,
  value,
  onChange,
  placeholder = "{}",
  description,
  disabled = false,
  error,
  rows = 6,
}: JsonEditorProps) {
  const [textValue, setTextValue] = useState("");
  const [isValid, setIsValid] = useState(true);
  const [parseError, setParseError] = useState<string | null>(null);

  // 初始化和同步外部值
  useEffect(() => {
    try {
      const formatted = JSON.stringify(value || {}, null, 2);
      setTextValue(formatted);
      setIsValid(true);
      setParseError(null);
    } catch (err) {
      setTextValue(JSON.stringify({}, null, 2));
      setIsValid(false);
    }
  }, [value]);

  const handleTextChange = (newText: string) => {
    setTextValue(newText);

    // 尝试解析 JSON
    try {
      const parsed = JSON.parse(newText);
      setIsValid(true);
      setParseError(null);
      onChange(parsed);
    } catch (err: any) {
      setIsValid(false);
      setParseError(err.message);
      // 不更新外部值，保持上一个有效值
    }
  };

  const handleFormat = () => {
    try {
      const parsed = JSON.parse(textValue);
      const formatted = JSON.stringify(parsed, null, 2);
      setTextValue(formatted);
      setIsValid(true);
      setParseError(null);
      onChange(parsed);
    } catch (err: any) {
      setParseError(err.message);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">{label}</Label>
        <div className="flex items-center gap-2">
          {isValid ? (
            <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200">
              <Check className="h-3 w-3 mr-1" />
              有效
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs bg-destructive/10 text-destructive border-destructive/20">
              <AlertCircle className="h-3 w-3 mr-1" />
              无效
            </Badge>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleFormat}
            disabled={disabled || !isValid}
            className="h-7 text-xs"
          >
            格式化
          </Button>
        </div>
      </div>

      <Textarea
        value={textValue}
        onChange={(e) => handleTextChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        rows={rows}
        className={cn(
          "font-mono text-xs",
          !isValid && "border-destructive focus-visible:ring-destructive"
        )}
      />

      {parseError && (
        <p className="text-xs text-destructive flex items-start gap-1">
          <AlertCircle className="h-3 w-3 mt-0.5 flex-shrink-0" />
          <span>{parseError}</span>
        </p>
      )}

      {error && (
        <p className="text-xs text-destructive flex items-start gap-1">
          <AlertCircle className="h-3 w-3 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </p>
      )}

      {description && !parseError && !error && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
    </div>
  );
}