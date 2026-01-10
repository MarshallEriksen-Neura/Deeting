'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/lib/i18n-context';
import { adminService, Role } from '@/http/admin';
import { toast } from 'sonner';

interface EditRoleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: Role;
  onSuccess: () => void;
}

export function EditRoleDialog({ open, onOpenChange, role, onSuccess }: EditRoleDialogProps) {
  const { t } = useI18n();
  const [formData, setFormData] = useState({
    name: role.name,
    description: role.description || '',
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setFormData({
      name: role.name,
      description: role.description || '',
    });
  }, [role]);

  const handleUpdate = async () => {
    if (!formData.name) {
      toast.error('Please fill in required fields');
      return;
    }

    try {
      setSubmitting(true);
      await adminService.updateRole(role.id, formData);
      toast.success('Role updated successfully');
      onOpenChange(false);
      onSuccess();
    } catch (error) {
      toast.error('Failed to update role');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('roles.edit_dialog_title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">{t('roles.label_role_name')}</label>
            <Input
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">{t('roles.label_role_code')}</label>
            <Input value={role.code} disabled className="bg-muted" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">{t('roles.label_role_desc')}</label>
            <Input
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleUpdate} disabled={submitting}>
            {submitting ? 'Saving...' : t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
