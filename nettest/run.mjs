#!/usr/bin/env node
/**
 * Run recreo's network scenarios on plaza's harness.
 *
 *   node nettest/run.mjs [scenario...]
 *
 * plaza is expected beside this repository, as it is for tools/sync-libs.sh.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { scenarios } from './scenarios.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const { build, Run } = await import(path.resolve(here, '../../plaza/nettest/lib.mjs'))
const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(scenarios)

if (!process.env.NOBUILD) build()
fs.mkdirSync(path.join(here, 'results'), { recursive: true })

let failed = 0
for (const name of names) {
  const scenario = scenarios[name]
  if (!scenario) { console.error(`no scenario called ${name}`); failed++; continue }
  const run = new Run(`recreo-${name}`)
  const started = Date.now()
  let verdict
  try {
    verdict = `PASS ${name} (${((Date.now() - started) / 1000).toFixed(0)}s) ${JSON.stringify(await scenario(run))}`
    verdict = verdict.replace(/\(\d+s\)/, `(${((Date.now() - started) / 1000).toFixed(0)}s)`)
  } catch (err) {
    failed++
    verdict = `FAIL ${name}: ${err.message}`
  }
  let pages = ''
  for (const label of run.peers.keys()) {
    try { pages += `\n--- ${label} transport log ---\n${(await run.cmd(label, 'tlog 300', 5000)).join('\n')}\n` } catch { /* gone */ }
  }
  const file = path.join(here, 'results', `${run.tag}.log`)
  fs.writeFileSync(file, `${verdict}\n\n${run.timeline()}\n${pages}\n--- everything ---\n${run.timeline(() => true)}\n`)
  console.log(`${verdict}\n  log: ${path.relative(process.cwd(), file)}`)
  if (!process.env.KEEP) run.close()
}
process.exit(failed ? 1 : 0)
