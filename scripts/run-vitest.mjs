import { realpathSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const realWorkspace = realpathSync(process.cwd())
const vitest = resolve(
  realWorkspace,
  'node_modules',
  'vitest',
  'vitest.mjs',
)
const result = spawnSync(process.execPath, [vitest, 'run'], {
  cwd: realWorkspace,
  stdio: 'inherit',
})

if (result.error) throw result.error
process.exitCode = result.status ?? 1
