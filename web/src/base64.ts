// Base64 编解码（UTF-8 安全）：FilePreview 与记事本共用的纯函数。
export function encodeB64(src: string): string {
  return btoa(unescape(encodeURIComponent(src)));
}

export function decodeB64(src: string): string {
  return decodeURIComponent(escape(atob(src.trim())));
}
