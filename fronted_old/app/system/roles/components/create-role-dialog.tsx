'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/lib/i18n-context';
import { adminService } from '@/http/admin';
import { toast } from 'sonner';

interface CreateRoleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function CreateRoleDialog({ open, onOpenChange, onSuccess }: CreateRoleDialogProps) {
  const { t } = useI18n();
  const [formData, setFormData] = useState({ code: '', name: '', description: '' });
  const [submitting, setSubmitting] = useState(false);

  const handleCreate = async () => {
    if (!formData.name || !formData.code) {
      toast.error('Please fill in required fields');
      return;
    }

    try {
      setSubmitting(true);
      await adminService.createRole(formData);
      toast.success('Role created successfully');
      onOpenChange(false);
      onSuccess();
      setFormData({ code: '', name: '', description: '' });
    } catch (error) {
      toast.error('Failed to create role');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('roles.create_dialog_title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">{t('roles.label_role_name')}</label>
            <Input
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g. System Administrator"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">{t('roles.label_role_code')}</label>
            <Input
              value={formData.code}
              onChange={(e) => setFormData({ ...formData, code: e.target.value })}
              placeholder="e.g. system_admin"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">{t('roles.label_role_desc')}</label>
            <Input
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Optional description"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleCreate} disabled={submitting}>
            {submitting ? 'Creating...' : t('roles.btn_create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
