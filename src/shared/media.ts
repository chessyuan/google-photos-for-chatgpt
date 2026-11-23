import { CHATGPT_IMAGE_LIMIT_BYTES } from './constants'
import type { PickedMediaItem } from './types'

// Local memory safeguards, not a promise about ChatGPT account upload limits.
export const VIDEO_LIMIT_BYTES = 100 * 1024 * 1024
export const TRANSFER_LIMIT_BYTES = 200 * 1024 * 1024

export function isVideo(item: PickedMediaItem): boolean {
  return item.type === 'VIDEO' || Boolean(item.mediaFile?.mimeType?.toLowerCase().startsWith('video/'))
}

export function mediaByteLimit(mimeType: string): number {
  return mimeType.toLowerCase().startsWith('video/') ? VIDEO_LIMIT_BYTES : CHATGPT_IMAGE_LIMIT_BYTES
}

export function mediaFilename(filename: string, mimeType: string): string {
  const extension = ({ 'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov' } as Record<string, string>)[mimeType]
  if (!extension || filename.toLowerCase().endsWith(extension)) return filename
  return filename.replace(/\.[^.]+$/, '') + extension
}
