import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const clientId = process.argv[2]?.trim()
const webClientId = process.argv[3]?.trim()
const validClientId = (value) =>
  /^[a-zA-Z0-9._-]+\.apps\.googleusercontent\.com$/.test(value ?? '')
if (
  !clientId ||
  !validClientId(clientId) ||
  (webClientId && !validClientId(webClientId))
) {
  console.error(
    'Usage: npm run configure-oauth -- "CHROME_CLIENT_ID.apps.googleusercontent.com" ["WEB_CLIENT_ID.apps.googleusercontent.com"]',
  )
  process.exitCode = 1
} else {
  const destination = resolve(process.cwd(), '.env.local')
  const values = ['GPFC_GOOGLE_CLIENT_ID=' + clientId]
  if (webClientId) values.push('GPFC_GOOGLE_WEB_CLIENT_ID=' + webClientId)
  await writeFile(
    destination,
    values.join('\n') + '\n',
    'utf8',
  )
  console.log('Saved OAuth client configuration to ' + destination)
  console.log('Next: npm run build')
}
