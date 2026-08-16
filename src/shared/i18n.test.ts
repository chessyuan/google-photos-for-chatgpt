import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { requiredMessageKeys } from './i18n'

interface LocaleMessage {
  message?: string
}

function readLocale(locale: 'en' | 'zh_CN'): Record<string, LocaleMessage> {
  return JSON.parse(
    readFileSync(
      resolve(process.cwd(), '_locales', locale, 'messages.json'),
      'utf8',
    ),
  ) as Record<string, LocaleMessage>
}

describe('extension localization', () => {
  it.each(['en', 'zh_CN'] as const)(
    '%s contains every required authorization and UI string',
    (locale) => {
      const messages = readLocale(locale)
      expect(Object.keys(messages).sort()).toEqual(
        [...requiredMessageKeys].sort(),
      )
      for (const key of requiredMessageKeys) {
        expect(messages[key]?.message?.trim(), key).toBeTruthy()
      }
    },
  )

  it('contains the complete required Chinese authorization vocabulary', () => {
    const chinese = readLocale('zh_CN')
    const combined = requiredMessageKeys
      .map((key) => chinese[key]?.message ?? '')
      .join('\n')
    for (const phrase of [
      '连接 Google 相册',
      '已连接',
      '重新连接',
      '断开 Google 相册',
      '授权失败',
      '授权已失效',
      '正在打开 Google 相册',
    ]) {
      expect(combined).toContain(phrase)
    }
  })
})
