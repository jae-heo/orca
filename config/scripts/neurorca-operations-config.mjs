import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const scriptsDir = import.meta.dirname

export const projectDir = resolve(scriptsDir, '../..')
export const operationsConfigPath = join(projectDir, 'config', 'neurorca-operations.json')

export function loadNeurorcaOperationsConfig() {
  const parsed = JSON.parse(readFileSync(operationsConfigPath, 'utf8'))
  if (parsed.schemaVersion !== 1) {
    throw new Error(`Unsupported Neurorca operations schema: ${parsed.schemaVersion}`)
  }
  return parsed
}

export function expandHomePath(filePath, home = homedir()) {
  if (filePath === '~') {
    return home
  }
  return filePath.startsWith('~/') ? join(home, filePath.slice(2)) : filePath
}

export function parseCommandJson(output, label) {
  try {
    return JSON.parse(output)
  } catch {
    throw new Error(`${label} returned invalid JSON.`)
  }
}
