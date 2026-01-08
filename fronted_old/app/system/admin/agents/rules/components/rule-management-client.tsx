"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Plus,
  CheckCircle,
  XCircle,
  History,
} from "lucide-react";

interface ProviderMetadata {
  id: string;
  provider_slug: string;
  name: string | null;
  base_url: string;
  auth_config: Record<string, any>;
  endpoints_config: Record<string, any> | null;
  model_list_config: Record<string, any> | null;
  is_active: boolean;
  version: string;
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export function RuleManagementClient() {
  const [isGenerateDialogOpen, setIsGenerateDialogOpen] = useState(false);
  const [isRollbackDialogOpen, setIsRollbackDialogOpen] = useState(false);
  const [selectedMetadata, setSelectedMetadata] = useState<ProviderMetadata | null>(null);
  const [loading, setLoading] = useState(false);
  const [rules, setRules] = useState<ProviderMetadata[]>([]);
  const [totalRules, setTotalRules] = useState(0);

  // Form states
  const [providerSlug, setProviderSlug] = useState("");
  const [sampleResponse, setSampleResponse] = useState("");
  const [rollbackVersion, setRollbackVersion] = useState("");

  // Fetch rules list
  const fetchRules = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("access_token");
      const response = await fetch("/api/v1/admin/rules?page=1&page_size=50", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch rules");
      }

      const data = await response.json();
      setRules(data.items || []);
      setTotalRules(data.total || 0);
    } catch (error) {
      toast.error("Failed to load rules");
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Generate rules
  const handleGenerateRules = useCallback(async () => {
    if (!providerSlug || !sampleResponse) {
      toast.error("Please fill in all fields");
      return;
    }

    try {
      const token = localStorage.getItem("access_token");
      const response = await fetch("/api/v1/admin/rules/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          provider_slug: providerSlug,
          sample_response: JSON.parse(sampleResponse),
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || "Failed to generate rules");
      }

      const result = await response.json();
      toast.success(`Rules generated successfully for ${providerSlug}`);
      console.log("Generated rules:", result);

      setIsGenerateDialogOpen(false);
      setProviderSlug("");
      setSampleResponse("");
      fetchRules();
    } catch (error: any) {
      toast.error(error.message || "Failed to generate rules");
      console.error(error);
    }
  }, [providerSlug, sampleResponse, fetchRules]);

  // Rollback rules
  const handleRollback = useCallback(async () => {
    if (!selectedMetadata || !rollbackVersion) {
      toast.error("Please select a version to rollback to");
      return;
    }

    try {
      const token = localStorage.getItem("access_token");
      const response = await fetch(`/api/v1/admin/rules/${selectedMetadata.id}/rollback`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          version: rollbackVersion,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || "Failed to rollback");
      }

      toast.success("Rollback successful");
      setIsRollbackDialogOpen(false);
      setSelectedMetadata(null);
      setRollbackVersion("");
      fetchRules();
    } catch (error: any) {
      toast.error(error.message || "Rollback failed");
      console.error(error);
    }
  }, [selectedMetadata, rollbackVersion, fetchRules]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  // Load rules on mount
  useState(() => {
    fetchRules();
  });

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Provider Rules</CardTitle>
            <Button onClick={() => setIsGenerateDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Generate Rules
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : rules.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              No rules found. Generate your first rule to get started.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Provider</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Verified</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((rule) => (
                  <TableRow key={rule.id}>
                    <TableCell className="font-medium">{rule.provider_slug}</TableCell>
                    <TableCell>{rule.name || "N/A"}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{rule.version}</Badge>
                    </TableCell>
                    <TableCell>
                      {rule.is_active ? (
                        <Badge className="bg-green-500/10 text-green-700 dark:text-green-400">
                          <CheckCircle className="mr-1 h-3 w-3" />
                          Active
                        </Badge>
                      ) : (
                        <Badge className="bg-gray-500/10 text-gray-700 dark:text-gray-400">
                          <XCircle className="mr-1 h-3 w-3" />
                          Inactive
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {rule.last_verified_at ? formatDate(rule.last_verified_at) : "Never"}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedMetadata(rule);
                            setIsRollbackDialogOpen(true);
                          }}
                        >
                          <History className="mr-1 h-3 w-3" />
                          History
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <div className="mt-4 text-sm text-muted-foreground">
            Total: {totalRules} rules
          </div>
        </CardContent>
      </Card>

      {/* Generate Rules Dialog */}
      <Dialog open={isGenerateDialogOpen} onOpenChange={setIsGenerateDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Generate Provider Rules</DialogTitle>
            <DialogDescription>
              Generate capability extraction rules from a sample /models response
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="provider_slug">Provider Slug</Label>
              <Input
                id="provider_slug"
                placeholder="e.g., openai, anthropic, custom-provider"
                value={providerSlug}
                onChange={(e) => setProviderSlug(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="sample_response">Sample /models Response (JSON)</Label>
              <Textarea
                id="sample_response"
                placeholder='{"data": [{"id": "gpt-4", "object": "model"}]}'
                value={sampleResponse}
                onChange={(e) => setSampleResponse(e.target.value)}
                rows={10}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Paste the JSON response from the provider's /models endpoint
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setIsGenerateDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleGenerateRules}>
                <Plus className="mr-2 h-4 w-4" />
                Generate
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Rollback Dialog */}
      <Dialog open={isRollbackDialogOpen} onOpenChange={setIsRollbackDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Version History</DialogTitle>
            <DialogDescription>
              Rollback {selectedMetadata?.provider_slug} to a previous version
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Current Version</Label>
              <div className="text-sm font-mono bg-muted p-2 rounded">
                {selectedMetadata?.version}
              </div>
            </div>
            <div>
              <Label htmlFor="rollback_version">Target Version</Label>
              <Input
                id="rollback_version"
                placeholder="e.g., 1.0.0"
                value={rollbackVersion}
                onChange={(e) => setRollbackVersion(e.target.value)}
              />
            </div>
            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded p-3 text-sm">
              <p className="text-yellow-700 dark:text-yellow-400">
                Note: Version rollback is not yet fully implemented. This feature requires a version history table.
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setIsRollbackDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleRollback} disabled>
                <History className="mr-2 h-4 w-4" />
                Rollback
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
