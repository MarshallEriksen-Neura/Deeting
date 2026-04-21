"use client";

import * as React from "react";
import { Bot, Server } from "lucide-react";
import { useTranslations } from "next-intl";
import { Container } from "@/components/ui/common/container";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/shadcn/card";
import { Badge } from "@/components/ui/shadcn/badge";
import { Skeleton } from "@/components/ui/shadcn/skeleton";
import { useProviderInstances } from "@/hooks/use-providers";
import { PageHeader } from "@/components/models/page-header";
import { ModelsManager } from "@/components/models/models-manager";

export function ModelManagementProvidersPage() {
  const tProviders = useTranslations("providers.manager");
  const { instances, isLoading } = useProviderInstances({ include_public: true });
  const [selectedInstanceId, setSelectedInstanceId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!instances.length) {
      setSelectedInstanceId(null);
      return;
    }
    if (!selectedInstanceId || !instances.some((instance) => instance.id === selectedInstanceId)) {
      setSelectedInstanceId(instances[0].id);
    }
  }, [instances, selectedInstanceId]);

  return (
    <Container as="main" size="full" gutter="md" className="py-6">
      <PageHeader title={tProviders("title")} description={tProviders("subtitle")} icon={Bot} />
      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Card className="h-fit xl:sticky xl:top-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Server className="size-4" />
              Provider Instances
            </CardTitle>
            <CardDescription>Select one desktop-local provider instance to manage its model inventory.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {isLoading ? (
              <>
                <Skeleton className="h-16 rounded-xl" />
                <Skeleton className="h-16 rounded-xl" />
                <Skeleton className="h-16 rounded-xl" />
              </>
            ) : instances.length ? (
              instances.map((instance) => {
                const selected = instance.id === selectedInstanceId;
                return (
                  <button
                    key={instance.id}
                    type="button"
                    onClick={() => setSelectedInstanceId(instance.id)}
                    className={`w-full rounded-xl border px-3 py-3 text-left transition ${selected ? "border-primary bg-primary/5" : "border-border/60 hover:bg-muted/40"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-[var(--ink)]">{instance.name}</div>
                        <div className="mt-1 truncate text-xs text-muted-foreground">{instance.base_url}</div>
                      </div>
                      <Badge variant={instance.is_enabled ? "default" : "secondary"}>
                        {instance.health_status || "unknown"}
                      </Badge>
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="rounded-xl border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
                {tProviders("empty")}
              </div>
            )}
          </CardContent>
        </Card>
        <div className="min-w-0">
          {selectedInstanceId ? (
            <ModelsManager instanceId={selectedInstanceId} />
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                Select or create a provider instance before managing models.
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </Container>
  );
}
