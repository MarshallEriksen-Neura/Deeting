'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useI18n } from '@/lib/i18n-context';
import { adminService, Role, Permission } from '@/http/admin';
import { toast } from 'sonner';

interface PermissionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: Role;
  permissions: Permission[];
}

export function PermissionsDialog({ open, onOpenChange, role, permissions }: PermissionsDialogProps) {
  const { t } = useI18n();
  const [selectedPerms, setSelectedPerms] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      loadRolePermissions();
    }
  }, [open, role.id]);

  const loadRolePermissions = async () => {
    try {
      setLoading(true);
      const data = await adminService.getRolePermissions(role.id);
      setSelectedPerms(data.permission_codes);
    } catch (error) {
      toast.error('Failed to fetch role permissions');
    } finally {
      setLoading(false);
    }
  };

  const togglePermission = (code: string) => {
    setSelectedPerms((prev) =>
      prev.includes(code) ? prev.filter((p) => p !== code) : [...prev, code]
    );
  };

  const savePermissions = async () => {
    try {
      setSubmitting(true);
      await adminService.setRolePermissions(role.id, {
        permission_codes: selectedPerms,
      });
      toast.success('Permissions updated successfully');
      onOpenChange(false);
    } catch (error) {
      toast.error('Failed to update permissions');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('roles.permissions_dialog_title')}</DialogTitle>
          <DialogDescription>
            {t('roles.permissions_desc')} ({role.name})
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 max-h-[60vh] overflow-y-auto">
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">Loading permissions...</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {permissions.map((perm) => (
                <div
                  key={perm.id}
                  className="flex items-start space-x-3 p-3 border rounded hover:bg-muted/50"
                >
                  <Checkbox
                    id={perm.code}
                    checked={selectedPerms.includes(perm.code)}
                    onCheckedChange={() => togglePermission(perm.code)}
                  />
                  <div className="grid gap-1.5 leading-none">
                    <label
                      htmlFor={perm.code}
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                    >
                      {perm.code}
                    </label>
                    <p className="text-xs text-muted-foreground">{perm.description}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button onClick={savePermissions} disabled={submitting || loading}>
            {submitting ? 'Saving...' : t('roles.permissions_save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
