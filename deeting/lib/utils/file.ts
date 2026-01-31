/**
 * 文件工具函数
 */

const bufferToHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")

/**
 * 计算文件的 SHA-256 哈希值
 */
export async function calculateFileHash(file: File): Promise<string> {
  const data = await file.arrayBuffer()
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data)
  return bufferToHex(digest)
}

/**
 * 格式化文件大小
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
}

/**
 * 验证文件类型
 */
export function isValidImageType(file: File): boolean {
  return file.type.startsWith("image/")
}

/**
 * 验证文件大小
 */
export function isValidFileSize(file: File, maxSizeMB: number): boolean {
  return file.size <= maxSizeMB * 1024 * 1024
}
