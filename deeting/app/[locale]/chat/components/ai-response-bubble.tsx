import { useState } from "react";
import { Brain, ChevronDown, ChevronRight, Loader2, Terminal } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useI18n } from "@/hooks/use-i18n";

// 消息部分接口
export interface MessagePart {
  type: 'text' | 'thought' | 'tool_call';
  content?: string;
  toolName?: string;
  toolArgs?: string;
  status?: 'running' | 'success' | 'error';
  cost?: string; // 思考耗时
}

export function AIResponseBubble({ parts }: { parts: MessagePart[] }) {
  return (
    <div className="flex flex-col gap-2 w-full items-start">
      <div className="space-y-3 w-full">
        {parts.map((part, index) => {
          // --- A. 思维链 (CoT) ---
          if (part.type === 'thought') {
            return <ThoughtBlock key={index} content={part.content} cost={part.cost} />;
          }

          // --- B. MCP 工具调用 ---
          if (part.type === 'tool_call') {
            return (
              <ToolCallBlock 
                key={index} 
                name={part.toolName} 
                args={part.toolArgs} 
                status={part.status} 
              />
            );
          }

          // --- C. 普通文本 ---
          // 如果是空文本（可能因为解析造成的空行），可以选择不渲染
          if (!part.content?.trim()) return null;

          return (
            <div key={index} className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap">
              {part.content}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// === 组件：思维链折叠块 ===
function ThoughtBlock({ content, cost }: { content?: string, cost?: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const t = useI18n("chat");

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="w-full">
      <CollapsibleTrigger asChild>
        <div className="flex items-center gap-2 cursor-pointer group select-none">
           <div className={cn(
             "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
             isOpen ? "bg-muted text-foreground" : "bg-muted/50 text-muted-foreground hover:bg-muted"
           )}>
             <Brain size={12} className={cn(!cost && "animate-pulse")} /> 
             <span>{cost ? t("thought.withCost", { cost }) : t("thought.label")}</span>
             {isOpen ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}
           </div>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 ml-2 pl-4 border-l-2 border-border text-xs text-muted-foreground font-mono whitespace-pre-wrap leading-relaxed">
          {content || t("thought.loading")}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// === 组件：MCP 工具块 ===
function ToolCallBlock({ name, args, status }: { name?: string, args?: string, status?: string }) {
  const isRunning = status === 'running';
  const isError = status === 'error';

  return (
    <div className={cn(
      "flex items-center gap-3 p-3 rounded-lg border text-sm w-full max-w-md transition-all",
      isRunning ? "border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-900/20" : "border-border bg-card",
      isError && "border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-900/20"
    )}>
      {/* Icon Status */}
      <div className={cn(
        "w-8 h-8 rounded flex items-center justify-center shrink-0",
        isRunning ? "bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300" : "bg-muted text-muted-foreground",
        isError && "bg-red-100 text-red-500 dark:bg-red-900 dark:text-red-300"
      )}>
        {isRunning ? <Loader2 size={16} className="animate-spin"/> : <Terminal size={16}/>}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="font-semibold font-mono truncate">{name}</span>
          <Badge variant="outline" className="text-[10px] h-5 font-normal text-muted-foreground">
            MCP
          </Badge>
        </div>
        <div className="text-xs text-muted-foreground truncate font-mono mt-0.5 opacity-80">
          {args}
        </div>
      </div>

      {/* Result Indicator (Click to view details) */}
      {!isRunning && (
        <div className="text-muted-foreground cursor-pointer hover:text-foreground">
           <ChevronRight size={16} />
        </div>
      )}
    </div>
  );
}
