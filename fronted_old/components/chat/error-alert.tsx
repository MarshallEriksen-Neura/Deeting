'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';
import { getErrorMessage } from '@/lib/errors/error-handler';

interface ErrorAlertProps {
  error: any;
  className?: string;
}

/**
 * 错误提示组件
 * 
 * 用于显示友好的错误消息，特别处理项目相关错误
 */
export function ErrorAlert({ error, className }: ErrorAlertProps) {
  if (!error) return null;
  
  const message = getErrorMessage(error);
  
  // 检查是否为项目相关错误
  const errorCode = error?.response?.data?.error || error?.error || '';
  const isProjectError = errorCode.includes('project') || errorCode === 'project_not_found';
  
  return (
    <Alert variant="destructive" className={className}>
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>错误</AlertTitle>
      <AlertDescription>
        <p>{message}</p>
        {isProjectError && (
          <p className="mt-2 text-sm">
            提示：请确保已选择正确的项目（API Key）
          </p>
        )}
      </AlertDescription>
    </Alert>
  );
}
