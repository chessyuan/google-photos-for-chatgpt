import { access, readFile, readdir, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

const expectedExtensionId = 'igacbcmbkglkglkindhcpmagafnboolj'
const expectedOAuthClient =
  '43154637059-a8t1kbv88cv9kj51edigsluh0gkbvn2m.apps.googleusercontent.com'

const dist = resolve(process.cwd(), 'dist')
const required = [
  'manifest.json',
  'background.js',
  'content.js',
  'popup.html',
  'options.html',
  'test.html',
  '_locales/en/messages.json',
  '_locales/zh_CN/messages.json',
]

for (const file of required) {
  await access(resolve(dist, file), constants.R_OK)
}

const manifest = JSON.parse(
  await readFile(resolve(dist, 'manifest.json'), 'utf8'),
)
if (manifest.manifest_version !== 3) {
  throw new Error('dist/manifest.json is not Manifest V3.')
}
if (manifest.version !== '1.1.0') {
  throw new Error('dist manifest is not version 1.1.0.')
}
if (
  manifest.default_locale !== 'en' ||
  manifest.name !== '__MSG_extensionName__' ||
  manifest.description !== '__MSG_extensionDescription__'
) {
  throw new Error('dist manifest localization metadata is incomplete.')
}
if ('message_serialization' in manifest) {
  throw new Error('dist manifest must use Chrome\'s stable JSON message protocol.')
}
const extensionId = [...createHash('sha256')
  .update(Buffer.from(manifest.key, 'base64'))
  .digest('hex')
  .slice(0, 32)]
  .map((digit) => String.fromCharCode(97 + Number.parseInt(digit, 16)))
  .join('')
if (extensionId !== expectedExtensionId) {
  throw new Error('dist manifest key generated an unexpected Extension ID.')
}
if (manifest.oauth2?.client_id !== expectedOAuthClient) {
  throw new Error('dist manifest contains an unexpected OAuth Client ID.')
}
if (
  manifest.oauth2?.scopes?.length !== 1 ||
  manifest.oauth2.scopes[0] !==
    'https://www.googleapis.com/auth/photospicker.mediaitems.readonly'
) {
  throw new Error('dist manifest does not contain exactly the Picker scope.')
}

const requiredLocaleKeys = [
  'connectGooglePhotos',
  'connected',
  'reconnect',
  'disconnect',
  'authorizationRequired',
  'authorizationFailed',
  'authorizationExpired',
  'authorizationCancelled',
  'openingGooglePhotos',
  'ready',
  'error',
  'browserAuthorizationUnsupported',
]
for (const locale of ['en', 'zh_CN']) {
  const messages = JSON.parse(
    await readFile(resolve(dist, '_locales', locale, 'messages.json'), 'utf8'),
  )
  for (const key of requiredLocaleKeys) {
    if (!messages[key]?.message?.trim()) {
      throw new Error(`dist locale ${locale} is missing ${key}.`)
    }
  }
}
if (
  manifest.host_permissions?.some((permission) =>
    permission.includes('photoslibrary.googleapis.com'),
  )
) {
  throw new Error('dist manifest unexpectedly references the old Library API.')
}

async function walk(directory) {
  const results = []
  for (const name of await readdir(directory)) {
    const path = resolve(directory, name)
    if ((await stat(path)).isDirectory()) results.push(...(await walk(path)))
    else results.push(path)
  }
  return results
}

for (const path of await walk(dist)) {
  if (path.endsWith('.map')) {
    throw new Error('Production dist unexpectedly contains a source map: ' + path)
  }
  if (!/\.(?:js|html|json)$/.test(path)) continue
  const content = await readFile(path, 'utf8')
  if (/https:\/\/(?:accounts\.google\.com\/gsi\/client|apis\.google\.com\/js)/.test(content)) {
    throw new Error('Remote executable code found in ' + path)
  }
  if (/GPFC PERF|console\.debug\(/.test(content)) {
    throw new Error('Production dist unexpectedly contains performance debug logs: ' + path)
  }
}

const background = await readFile(resolve(dist, 'background.js'), 'utf8')
if (/\.tabs\.create\(/.test(background)) {
  throw new Error('Production background must not preload Picker in the main tab strip.')
}

if (manifest.oauth2.client_id.startsWith('REPLACE_WITH_')) {
  console.warn(
    'dist structure is valid, but OAuth remains intentionally unconfigured. Run configure-oauth with a real Client ID and rebuild before live Picker testing.',
  )
}

console.log(
  'dist verification passed: ' +
    required.length +
    ' required files, MV3 Picker scope, and en/zh_CN localization.',
)
