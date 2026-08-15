import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const clientId = process.argv[2]?.trim()
if (
  !clientId ||
  !/^[a-zA-Z0-9._-]+\.apps\.googleusercontent\.com$/.test(clientId)
) {
  console.error(
    'Usage: npm run configure-oauth -- "YOUR_CLIENT_ID.apps.googleusercontent.com"',
  )
  process.exitCode = 1
} else {
  const destination = resolve(process.cwd(), '.env.local')
  await writeFile(
    destination,
    'GPFC_GOOGLE_CLIENT_ID=' + clientId + '\n',
    'utf8',
  )
  console.log('Saved OAuth Client ID to ' + destination)
  console.log('Next: npm run build')
}
