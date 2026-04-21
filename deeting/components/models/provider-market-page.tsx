"use client";

import * as React from "react";
import { Store, Zap } from "lucide-react";
import { useTranslations } from "next-intl";
import { Container } from "@/components/ui/common/container";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/shadcn/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/shadcn/tabs";
import { Input } from "@/components/ui/shadcn/input";
import { Badge } from "@/components/ui/shadcn/badge";
import { useProviderHub } from "@/hooks/use-providers";
import { PageHeader } from "@/components/models/page-header";
import type { ProviderCard } from "@/lib/api/providers";

function categoryLabel(category: string | null | undefined) {
  if (!category) return "unknown";
  return category;
}

function ProviderMarketGrid({ providers }: { providers: ProviderCard[] }) {
  const t = useTranslations("providers.market");

  if (!providers.length) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          {t("grid.emptyTitle")}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {providers.map((provider) => (
        <Card key={provider.slug} className="border-border/60 bg-card/80">
          <CardHeader className="gap-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">{provider.name}</CardTitle>
                <CardDescription>{provider.provider}</CardDescription>
              </div>
              <Badge variant={provider.connected ? "default" : "secondary"}>
                {provider.connected ? t("card.connected") : categoryLabel(provider.category)}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>{provider.description || t("card.noDescription")}</p>
            <div className="flex flex-wrap gap-2">
              {(provider.capabilities || []).slice(0, 4).map((capability) => (
                <Badge key={capability} variant="outline">
                  {capability}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function ProviderMarketPage() {
  const t = useTranslations("providers.market");
  const [selectedTab, setSelectedTab] = React.useState<"all" | "cloud" | "local">("all");
  const [query, setQuery] = React.useState("");

  const params = React.useMemo(() => {
    if (selectedTab === "cloud") {
      return { category: "cloud api", q: query || undefined, include_public: true };
    }
    if (selectedTab === "local") {
      return { category: "local hosted", q: query || undefined, include_public: true };
    }
    return { q: query || undefined, include_public: true };
  }, [query, selectedTab]);

  const { providers, stats, isLoading } = useProviderHub(params);

  return (
    <Container as="main" size="full" gutter="md" className="py-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        icon={Store}
        actions={
          <Badge variant="outline" className="gap-1 px-3 py-1 text-xs">
            <Zap className="size-3.5" />
            {stats ? `${stats.connected}/${stats.total}` : "--/--"}
          </Badge>
        }
      />

      <div className="mb-6 space-y-4">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("searchPlaceholder")}
          className="max-w-xl"
        />
        <Tabs value={selectedTab} onValueChange={(value) => setSelectedTab(value as "all" | "cloud" | "local") }>
          <TabsList>
            <TabsTrigger value="all">{t("tabs.all")}</TabsTrigger>
            <TabsTrigger value="cloud">{t("tabs.cloud")}</TabsTrigger>
            <TabsTrigger value="local">{t("tabs.local")}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">{t("grid.loading")}</CardContent>
        </Card>
      ) : (
        <ProviderMarketGrid providers={providers} />
      )}
    </Container>
  );
}
