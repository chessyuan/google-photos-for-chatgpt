export const requiredMessageKeys = [
  'extensionName',
  'extensionDescription',
  'appTitle',
  'appSubtitle',
  'checkingConnection',
  'connected',
  'connectedDetail',
  'connectGooglePhotos',
  'reconnect',
  'disconnect',
  'authorizationRequired',
  'authorizationFailed',
  'authorizationExpired',
  'authorizationCancelled',
  'openingGooglePhotos',
  'ready',
  'error',
  'selectFromGooglePhotos',
  'maximumPhotos',
  'openChatGptFirst',
  'developmentBuildNotConfigured',
  'developerTests',
  'phaseOne',
  'phaseTwo',
  'options',
  'connectionHeading',
  'privacyPolicy',
  'privacyPolicyChinese',
  'privacySummary',
  'developerDocumentation',
  'disconnectComplete',
  'reconnectComplete',
  'connectComplete',
  'googlePhotosServiceUnavailable',
  'googlePhotosPermissionDenied',
  'googlePhotosRequestTimedOut',
  'pickerOpeningFailed',
  'pickerOpeningInterrupted',
  'browserAuthorizationUnsupported',
  'addingPhotos',
  'photosAdded',
  'compatibilityWarnings',
] as const

export type MessageKey = (typeof requiredMessageKeys)[number]

const englishFallbacks: Record<MessageKey, string> = {
  extensionName: 'Google Photos for ChatGPT',
  extensionDescription:
    'Select photos with the official Google Photos Picker and attach them to ChatGPT.',
  appTitle: 'Google Photos',
  appSubtitle: 'for ChatGPT',
  checkingConnection: 'Checking Google Photos connection…',
  connected: 'Connected',
  connectedDetail: 'Google account authorized',
  connectGooglePhotos: 'Connect Google Photos',
  reconnect: 'Reconnect',
  disconnect: 'Disconnect Google Photos',
  authorizationRequired: 'Connect your Google account to use Google Photos.',
  authorizationFailed:
    'Google Photos authorization failed. Please try connecting again.',
  authorizationExpired:
    'Google Photos authorization expired. Please reconnect your Google account.',
  authorizationCancelled: 'Google Photos connection was cancelled.',
  openingGooglePhotos: 'Opening Google Photos…',
  ready: 'Ready',
  error: 'Error',
  selectFromGooglePhotos: 'Select from Google Photos',
  maximumPhotos: 'Maximum photos',
  openChatGptFirst: 'Open ChatGPT in the active tab first.',
  developmentBuildNotConfigured:
    'This development build is not configured for Google Photos. See the developer documentation.',
  developerTests: 'Developer tests',
  phaseOne: 'Open Phase 1 test page',
  phaseTwo: 'Run Phase 2 ChatGPT test',
  options: 'Connection and privacy',
  connectionHeading: 'Google Photos connection',
  privacyPolicy: 'Privacy Policy',
  privacyPolicyChinese: '隐私政策（简体中文）',
  privacySummary:
    'Authorization is handled by Chrome and Google Identity. Selected photos are processed in browser memory. The extension has no custom backend, analytics, or telemetry.',
  developerDocumentation: 'Developer documentation',
  disconnectComplete: 'Google Photos is disconnected.',
  reconnectComplete: 'Google Photos was reconnected.',
  connectComplete: 'Google Photos is connected.',
  googlePhotosServiceUnavailable:
    'Google Photos is temporarily unavailable. Please try again.',
  googlePhotosPermissionDenied:
    'Google Photos access is unavailable for this account. Please reconnect or contact the extension maintainer.',
  googlePhotosRequestTimedOut:
    'Google Photos did not respond in time. Check your connection and try again.',
  pickerOpeningFailed:
    'Google Photos could not be opened. Please try again.',
  pickerOpeningInterrupted:
    'The previous Picker start was interrupted. Click Google Photos to try again.',
  browserAuthorizationUnsupported:
    'This browser does not support Chrome Google authorization for extensions. Use Google Chrome, or wait for an Edge-compatible OAuth build.',
  addingPhotos: 'Adding photos…',
  photosAdded: '$1 photo(s) added to ChatGPT.',
  compatibilityWarnings: '$1 compatibility warning(s) are available in the extension popup.',
}

function fallbackWithSubstitutions(
  fallback: string,
  substitutions?: string | string[],
): string {
  const values = Array.isArray(substitutions)
    ? substitutions
    : substitutions === undefined
      ? []
      : [substitutions]
  return fallback.replace(/\$(\d+)/g, (match, index: string) => {
    return values[Number(index) - 1] ?? match
  })
}

export function message(
  key: MessageKey,
  substitutions?: string | string[],
): string {
  try {
    const translated = chrome.i18n.getMessage(key, substitutions)
    if (translated) return translated
  } catch {
    // Unit tests and non-extension previews use the English fallback.
  }
  return fallbackWithSubstitutions(englishFallbacks[key], substitutions)
}

export function localizeDocument(root: ParentNode = document): void {
  try {
    const language = chrome.i18n.getUILanguage()
    document.documentElement.lang = language.startsWith('zh') ? 'zh-CN' : 'en'
  } catch {
    document.documentElement.lang = 'en'
  }
  document.title = message('extensionName')

  for (const element of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = element.dataset.i18n as MessageKey | undefined
    if (key) element.textContent = message(key)
  }
  for (const element of root.querySelectorAll<HTMLElement>('[data-i18n-aria-label]')) {
    const key = element.dataset.i18nAriaLabel as MessageKey | undefined
    if (key) element.setAttribute('aria-label', message(key))
  }
}
