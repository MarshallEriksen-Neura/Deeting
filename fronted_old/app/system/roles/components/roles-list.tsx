'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Shield, Edit, Trash2, Lock } from 'lucide-react';
import { useI18n } from '@/lib/i18n-context';
import { Role } from '@/http/admin';

interface RolesListProps {
  roles: Role[];
  loading: boolean;
  onEdit: (role: Role) => void;
  onDelete: (roleId: string) => void;
  onManagePermissions: (role: Role) => void;
}

export function RolesList({ roles, loading, onEdit, onDelete, onManagePermissions }: RolesListProps) {
  const { t } = useI18n();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('roles.title')}</CardTitle>
        <CardDescription>{t('roles.subtitle')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('roles.table_column_name')}</TableHead>
              <TableHead>{t('roles.table_column_code')}</TableHead>
              <TableHead>{t('roles.table_column_description')}</TableHead>
              <TableHead className="text-right">{t('roles.table_column_actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {roles.map((role) => (
              <TableRow key={role.id}>
                <TableCell className="font-medium">
                  <div className="flex items-center">
                    <Shield className="w-4 h-4 mr-2 text-muted-foreground" />
                    {role.name}
                  </div>
                </TableCell>
                <TableCell>
                  <code className="bg-muted px-1 py-0.5 rounded text-xs">{role.code}</code>
                </TableCell>
                <TableCell className="text-muted-foreground">{role.description}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end space-x-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onManagePermissions(role)}
                        >
                          <Lock className="w-4 h-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t('roles.tooltip_permissions')}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="sm" onClick={() => onEdit(role)}>
                          <Edit className="w-4 h-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t('roles.tooltip_edit')}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="sm" onClick={() => onDelete(role.id)}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t('roles.tooltip_delete')}</TooltipContent>
                    </Tooltip>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {!loading && roles.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                  {t('common.no_data')}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
