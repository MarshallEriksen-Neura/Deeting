/**
 * 错误处理类型定义
 * 
 * 定义了统一的错误对象结构、错误分类和严重程度等级
 */

/**
 * 错误严重程度
 */
export enum ErrorSeverity {
  /** 信息提示 - 不影响操作，仅作提示 */
  INFO = 'info',
  /** 警告 - 可能影响操作，但可以继续 */
  WARNING = 'warning',
  /** 错误 - 操作失败，需要用户处理 */
  ERROR = 'error',
  /** 严重错误 - 系统级错误，可能需要技术支持 */
  CRITICAL = 'critical'
}

/**
 * 错误分类
 */
export enum ErrorCategory {
  /** 网络相关错误 */
  NETWORK = 'network',
  /** 认证相关错误 */
  AUTH = 'auth',
  /** 权限相关错误 */
  PERMISSION = 'permission',
  /** 验证相关错误 */
  VALIDATION = 'validation',
  /** 业务逻辑错误 */
  BUSINESS = 'business',
  /** 服务器错误 */
  SERVER = 'server',
  /** 未知错误 */
  UNKNOWN = 'unknown'
}

/**
 * 标准化错误对象
 * 
 * 整合后端返回的错误信息和前端增强的元数据
 */
export interface StandardError {
  // ===== 后端返回的标准字段 =====
  /** 错误类型标识 (如 "not_found", "forbidden") */
  error: string;
  /** 原始错误消息 */
  message: string;
  /** HTTP 状态码 */
  code: number;
  /** 额外的结构化错误详情 */
  details?: Record<string, any>;
  
  // ===== 前端增强字段 =====
  /** 错误分类 */
  category: ErrorCategory;
  /** 错误严重程度 */
  severity: ErrorSeverity;
  /** 国际化 key，用于获取用户友好的错误消息 */
  i18nKey?: string;
  /** 用户友好的错误消息（如果不使用 i18n） */
  userMessage?: string;
  /** 是否可以提供操作建议 */
  actionable?: boolean;
  /** 是否可以重试 */
  retryable?: boolean;
}

/**
 * 错误映射配置项
 * 
 * 用于配置特定错误类型的元数据
 */
export interface ErrorMapping {
  category: ErrorCategory;
  severity: ErrorSeverity;
  i18nKey?: string;
  retryable?: boolean;
  actionable?: boolean;
}