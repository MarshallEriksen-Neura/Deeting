/**
 * 通用剪贴板复制工具
 * 提供多种兼容性方法来复制文本到剪贴板
 */

export interface CopyResult {
  success: boolean;
  method?: string;
  error?: string;
}

/**
 * 复制文本到剪贴板
 * 按优先级尝试多种方法：
 * 1. navigator.clipboard API (现代浏览器)
 * 2. document.execCommand (传统方法)
 */
export async function copyToClipboard(text: string): Promise<CopyResult> {
  // 方法1: 现代 Clipboard API
  if (navigator?.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return { success: true, method: 'clipboard-api' };
    } catch (error) {
      console.warn('Clipboard API failed:', error);
      // 继续尝试其他方法
    }
  }

  // 方法2: 传统 execCommand 方法 (使用 textarea)
  return new Promise<CopyResult>((resolve) => {
    try {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      
      // 设置样式使其不可见但仍可操作
      textArea.style.position = 'fixed';
      textArea.style.top = '0';
      textArea.style.left = '0';
      textArea.style.width = '2em';
      textArea.style.height = '2em';
      textArea.style.padding = '0';
      textArea.style.border = 'none';
      textArea.style.outline = 'none';
      textArea.style.boxShadow = 'none';
      textArea.style.background = 'transparent';
      textArea.style.opacity = '0';
      textArea.style.zIndex = '-1';
      
      document.body.appendChild(textArea);
      
      // 选择文本
      textArea.focus();
      textArea.select();
      
      // 尝试复制
      try {
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        
        if (successful) {
          resolve({ success: true, method: 'execCommand' });
        } else {
          resolve({ 
            success: false, 
            error: '复制命令执行失败，请手动选择并复制文本' 
          });
        }
      } catch (err) {
        document.body.removeChild(textArea);
        resolve({ 
          success: false, 
          error: '复制功能不可用，请手动选择并复制文本' 
        });
      }
    } catch (error) {
      resolve({ 
        success: false, 
        error: `复制失败: ${error instanceof Error ? error.message : String(error)}` 
      });
    }
  });
}

/**
 * 检查是否支持剪贴板 API
 */
export function isClipboardSupported(): boolean {
  return !!(navigator?.clipboard && window.isSecureContext);
}

/**
 * 检查是否支持 execCommand
 */
export function isExecCommandSupported(): boolean {
  return document.queryCommandSupported && document.queryCommandSupported('copy');
}

/**
 * 获取支持的复制方法信息
 */
export function getClipboardSupport() {
  return {
    clipboardAPI: isClipboardSupported(),
    execCommand: isExecCommandSupported(),
    manualSelect: true, // 总是支持手动选择
  };
}