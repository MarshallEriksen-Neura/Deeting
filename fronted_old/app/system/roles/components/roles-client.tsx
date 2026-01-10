'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { useI18n } from '@/lib/i18n-context';
import { adminService, Role, Permission } from '@/http/admin';
import { toast } from 'sonner';
import { RolesList } from './roles-list';
import dynamic from 'next/dynamic';

// 动态导入对话框组件
const CreateRoleDialog = dynamic(() => import('./create-role-dialog').then(mod => ({ default: mod.CreateRoleDialog })), {
  ssr: false,
});

const EditRoleDialog = dynamic(() => import('./edit-role-dialog').then(mod => ({ default: mod.EditRoleDialog })), {
  ssr: false,
});

const PermissionsDialog = dynamic(() => import('./permissions-dialog').then(mod => ({ default: mod.PermissionsDialog })), {
  ssr: false,
});

export function RolesClient() {
  const { t } = useI18n();
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);

  // Dialog states
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [permOpen, setPermOpen] = useState(false);

  // Current role for editing/permissions
  const [currentRole, setCurrentRole] = useState<Role | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [rolesData, permsData] = await Promise.all([
        adminService.getRoles(),
        adminService.getPermissions(),
      ]);
      setRoles(rolesData);
      setPermissions(permsData);
    } catch (error) {
      console.error('Failed to fetch data:', error);
      toast.error('Failed to load roles and permissions');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (roleId: string) => {
    if (!confirm(t('roles.delete_confirm'))) return;
    try {
      await adminService.deleteRole(roleId);
      toast.success('Role deleted successfully');
      fetchData();
    } catch (error) {
      toast.error('Failed to delete role');
    }
  };

  const openEditDialog = (role: Role) => {
    setCurrentRole(role);
    setEditOpen(true);
  };

  const openPermissionsDialog = (role: Role) => {
    setCurrentRole(role);
    setPermOpen(true);
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">{t('roles.title')}</h1>
          <p className="text-muted-foreground">{t('roles.subtitle')}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          {t('roles.add_role')}
        </Button>
      </div>

      <RolesList
        roles={roles}
        loading={loading}
        onEdit={openEditDialog}
        onDelete={handleDelete}
        onManagePermissions={openPermissionsDialog}
      />

      {createOpen && (
        <CreateRoleDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onSuccess={fetchData}
        />
      )}

      {editOpen && currentRole && (
        <EditRoleDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          role={currentRole}
          onSuccess={fetchData}
        />
      )}

      {permOpen && currentRole && (
        <PermissionsDialog
          open={permOpen}
          onOpenChange={setPermOpen}
          role={currentRole}
          permissions={permissions}
        />
      )}
    </>
  );
}
