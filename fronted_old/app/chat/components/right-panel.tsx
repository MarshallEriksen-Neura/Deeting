"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Clock, Sparkles } from "lucide-react";

export function RightPanel() {
  return (
    <div className="flex h-full flex-col border-l bg-card">
      {/* 上半部分：预设 Prompt */}
      <div className="flex-1 border-b">
        <div className="border-b p-4">
          <h3 className="font-semibold flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            预设 Prompt
          </h3>
        </div>
        <ScrollArea className="h-[calc(100%-57px)]">
          <div className="p-4 space-y-3">
            {/* 示例预设 Prompt */}
            {[
              {
                title: "测试 juice 和 Kiro 编辑器的对话",
                tags: ["今天"],
              },
              {
                title: "Redis 劳模算法有什么",
                tags: ["今天"],
              },
              {
                title: "日本东京外 security txt 文件",
                tags: ["今天"],
              },
              {
                title: "财富人们的入门手册",
                tags: ["十一月"],
              },
              {
                title: "关于 droid 的问题",
                tags: ["十一月"],
              },
              {
                title: "linuxdo 合文问题",
                tags: ["十一月"],
              },
              {
                title: "土豆炒牛肉的做法",
                tags: ["十一月"],
              },
              {
                title: "shacn ui 介绍",
                tags: ["十一月"],
              },
              {
                title: "用户注册流程",
                tags: ["十一月"],
              },
              {
                title: "Vercel 跟 Next.js 的关系",
                tags: ["十一月"],
              },
            ].map((prompt, index) => (
              <Card
                key={index}
                className="cursor-pointer hover:bg-muted/50 transition-colors"
              >
                <CardContent className="p-3">
                  <p className="text-sm line-clamp-2">{prompt.title}</p>
                  <div className="mt-2 flex items-center gap-2">
                    {prompt.tags.map((tag, tagIndex) => (
                      <span
                        key={tagIndex}
                        className="text-xs text-muted-foreground"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* 下半部分：历史记录 */}
      <div className="flex-1">
        <div className="border-b p-4">
          <h3 className="font-semibold flex items-center gap-2">
            <Clock className="h-4 w-4" />
            历史记录
          </h3>
        </div>
        <ScrollArea className="h-[calc(100%-57px)]">
          <div className="p-4 space-y-2">
            {/* 按日期分组 */}
            <div className="space-y-3">
              <div className="text-xs font-medium text-muted-foreground">
                今天
              </div>
              {[
                "别墅 TypeScript 建筑专家",
                "API 文档助手",
                "Zustand reducer Expert",
              ].map((item, index) => (
                <Button
                  key={index}
                  variant="ghost"
                  className="w-full justify-start h-auto py-2 px-3"
                >
                  <span className="text-sm truncate">{item}</span>
                </Button>
              ))}
            </div>

            <Separator className="my-3" />

            <div className="space-y-3">
              <div className="text-xs font-medium text-muted-foreground">
                昨天
              </div>
              {[
                "React Native 编码助手",
                "编程专家代理",
                "软件开发入门",
              ].map((item, index) => (
                <Button
                  key={index}
                  variant="ghost"
                  className="w-full justify-start h-auto py-2 px-3"
                >
                  <span className="text-sm truncate">{item}</span>
                </Button>
              ))}
            </div>

            <Separator className="my-3" />

            <div className="space-y-3">
              <div className="text-xs font-medium text-muted-foreground">
                十一月
              </div>
              {[
                "财富人们的入门手册",
                "关于 droid 的问题",
                "linuxdo 合文问题",
                "土豆炒牛肉的做法",
                "shacn ui 介绍",
              ].map((item, index) => (
                <Button
                  key={index}
                  variant="ghost"
                  className="w-full justify-start h-auto py-2 px-3"
                >
                  <span className="text-sm truncate">{item}</span>
                </Button>
              ))}
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
