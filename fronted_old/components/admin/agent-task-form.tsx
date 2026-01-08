"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n-context";

interface AgentTaskFormProps {
  onSubmit: (data: { url: string; tags?: string[] }) => void;
  submitting?: boolean;
}

export function AgentTaskForm({ onSubmit, submitting }: AgentTaskFormProps) {
  const { t } = useI18n();
  const [url, setUrl] = useState("");
  const [tags, setTags] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const tagArray = tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    onSubmit({ url, tags: tagArray.length > 0 ? tagArray : undefined });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="url">{t("system.agents.form.url")}</Label>
        <Input
          id="url"
          type="url"
          placeholder="https://example.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
          disabled={submitting}
        />
        <p className="text-sm text-muted-foreground">
          {t("system.agents.form.url_description")}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="tags">{t("system.agents.form.tags")}</Label>
        <Input
          id="tags"
          type="text"
          placeholder="tag1, tag2, tag3"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          disabled={submitting}
        />
        <p className="text-sm text-muted-foreground">
          {t("system.agents.form.tags_description")}
        </p>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={submitting || !url}>
          {submitting ? t("system.agents.form.creating") : t("system.agents.form.create")}
        </Button>
      </div>
    </form>
  );
}
