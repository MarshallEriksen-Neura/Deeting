/**
 * 复制到剪贴板工具函数
 * 
 * 提供跨浏览器的复制功能，支持降级方案
 */

/**
 * 复制文本到剪贴板
 * 
 * @param text - 要复制的文本
 * @returns Promise<boolean> - 复制是否成功
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) {
    return false;
  }

  // 优先使用现代 Clipboard API
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      console.warn('Clipboard API failed, falling back to legacy method:', error);
      // 降级到传统方法
      return fallbackCopyToClipboard(text);
    }
  }

  // 降级到传统方法
  return fallbackCopyToClipboard(text);
}

/**
 * 降级复制方法（兼容旧浏览器）
 * 
 * @param text - 要复制的文本
 * @returns boolean - 复制是否成功
 */
function fallbackCopyToClipboard(text: string): boolean {
  try {
    // 创建临时文本域
    const textArea = document.createElement('textarea');
    textArea.value = text;
    
    // 设置样式使其不可见
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    textArea.style.opacity = '0';
    textArea.style.pointerEvents = 'none';
    
    // 添加到 DOM
    document.body.appendChild(textArea);
    
    // 选中文本
    textArea.focus();
    textArea.select();
    textArea.setSelectionRange(0, text.length);
    
    // 执行复制命令
    const successful = document.execCommand('copy');
    
    // 清理
    document.body.removeChild(textArea);
    
    return successful;
  } catch (error) {
    console.error('Fallback copy failed:', error);
    return false;
  }
}

/**
 * 从 Markdown 内容中提取纯文本
 * 
 * @param markdown - Markdown 格式的文本
 * @returns string - 纯文本内容
 */
export function extractPlainTextFromMarkdown(markdown: string): string {
  if (!markdown) {
    return '';
  }

  let text = markdown;

  // 移除代码块
  text = text.replace(/```[\s\S]*?```/g, '');
  
  // 移除行内代码
  text = text.replace(/`[^`]+`/g, '');
  
  // 移除标题标记
  text = text.replace(/^#{1,6}\s+/gm, '');
  
  // 移除粗体标记
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
  text = text.replace(/__([^_]+)__/g, '$1');
  
  // 移除斜体标记
  text = text.replace(/\*([^*]+)\*/g, '$1');
  text = text.replace(/_([^_]+)_/g, '$1');
  
  // 移除删除线标记
  text = text.replace(/~~([^~]+)~~/g, '$1');
  
  // 移除链接标记，保留链接文本
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  
  // 移除图片标记
  text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');
  
  // 移除引用标记
  text = text.replace(/^>\s+/gm, '');
  
  // 移除列表标记
  text = text.replace(/^[\s]*[-*+]\s+/gm, '');
  text = text.replace(/^[\s]*\d+\.\s+/gm, '');
  
  // 移除水平线
  text = text.replace(/^[-*_]{3,}\s*$/gm, '');
  
  // 移除多余的空行
  text = text.replace(/\n{3,}/g, '\n\n');
  
  // 去除首尾空白
  text = text.trim();

  return text;
}

/**
 * 复制 Markdown 内容（可选择是否转换为纯文本）
 * 
 * @param content - 要复制的内容
 * @param asPlainText - 是否转换为纯文本（默认 false）
 * @returns Promise<boolean> - 复制是否成功
 */
export async function copyContent(
  content: string,
  asPlainText: boolean = false
): Promise<boolean> {
  const textToCopy = asPlainText 
    ? extractPlainTextFromMarkdown(content)
    : content;
  
  return copyToClipboard(textToCopy);
}
