/**
 * 错误相关的国际化文案
 */

import type { Language } from "../i18n-context";

export const errorsTranslations: Record<Language, Record<string, string>> = {
  en: {
    // ===== 通用错误 =====
    "errors.generic": "An error occurred",
    "errors.unknown_error": "Unknown error occurred",
    "errors.client_error": "Client error occurred",
    
    // ===== 网络错误 =====
    "errors.network_generic": "Network connection failed",
    "errors.network_error": "Unable to connect to server. Please check your network connection.",
    "errors.timeout": "Request timeout. Please try again.",
    
    // ===== 认证错误 =====
    "errors.auth_generic": "Authentication failed",
    "errors.unauthorized": "Please log in to continue",
    "errors.token_expired": "Your session has expired. Please log in again.",
    
    // ===== 权限错误 =====
    "errors.permission_generic": "Permission denied",
    "errors.forbidden": "You don't have permission to perform this action",
    
    // ===== 验证错误 =====
    "errors.validation_generic": "Invalid input",
    "errors.validation_error": "Please check your input and try again",
    "errors.bad_request": "Invalid request. Please check your input.",
    
    // ===== 业务错误 =====
    "errors.not_found": "The requested resource was not found",
    "errors.quota_exceeded": "You have exceeded your quota limit",
    "errors.method_not_allowed": "This operation is not allowed",
    "errors.conflict": "A conflict occurred. The resource may have been modified.",
    "errors.rate_limit_exceeded": "Too many requests. Please try again later.",
    
    // ===== 服务器错误 =====
    "errors.server_generic": "Server error occurred",
    "errors.server_error": "Server encountered an error. Please try again later.",
    "errors.service_unavailable": "Service is temporarily unavailable. Please try again later.",
    "errors.bad_gateway": "Gateway error. Please try again later.",
    "errors.gateway_timeout": "Gateway timeout. Please try again later.",
    
    // ===== 错误提示 =====
    "errors.critical_description": "A critical error occurred. If this persists, please contact support.",
    "errors.hint_retry": "You can try again",
    "errors.hint_check_input": "Please check your input",
    "errors.hint_permission": "You may need additional permissions",
    
    // ===== 操作按钮 =====
    "common.retry": "Retry",
    "common.contact_support": "Contact Support",
    "common.dismiss": "Dismiss",
  },
  zh: {
    // ===== 通用错误 =====
    "errors.generic": "发生错误",
    "errors.unknown_error": "发生未知错误",
    "errors.client_error": "客户端错误",
    
    // ===== 网络错误 =====
    "errors.network_generic": "网络连接失败",
    "errors.network_error": "无法连接到服务器，请检查网络连接",
    "errors.timeout": "请求超时，请重试",
    
    // ===== 认证错误 =====
    "errors.auth_generic": "认证失败",
    "errors.unauthorized": "请登录后继续",
    "errors.token_expired": "会话已过期，请重新登录",
    
    // ===== 权限错误 =====
    "errors.permission_generic": "权限不足",
    "errors.forbidden": "您没有权限执行此操作",
    
    // ===== 验证错误 =====
    "errors.validation_generic": "输入无效",
    "errors.validation_error": "请检查输入内容后重试",
    "errors.bad_request": "请求无效，请检查输入内容",
    
    // ===== 业务错误 =====
    "errors.not_found": "请求的资源不存在",
    "errors.quota_exceeded": "您已超出配额限制",
    "errors.method_not_allowed": "不允许此操作",
    "errors.conflict": "发生冲突，资源可能已被修改",
    "errors.rate_limit_exceeded": "请求过于频繁，请稍后再试",
    
    // ===== 服务器错误 =====
    "errors.server_generic": "服务器错误",
    "errors.server_error": "服务器遇到错误，请稍后重试",
    "errors.service_unavailable": "服务暂时不可用，请稍后重试",
    "errors.bad_gateway": "网关错误，请稍后重试",
    "errors.gateway_timeout": "网关超时，请稍后重试",
    
    // ===== 错误提示 =====
    "errors.critical_description": "发生严重错误，如果问题持续存在，请联系技术支持",
    "errors.hint_retry": "您可以重试",
    "errors.hint_check_input": "请检查您的输入",
    "errors.hint_permission": "您可能需要额外的权限",
    
    // ===== 操作按钮 =====
    "common.retry": "重试",
    "common.contact_support": "联系技术支持",
    "common.dismiss": "关闭",
  }
};