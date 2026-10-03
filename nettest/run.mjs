#!/usr/bin/env node
/**
 * Run recreo's network scenarios on plaza's harness.
 *
 *   node nettest/run.mjs              the quick set, several at once
 *   node nettest/run.mjs --all        everything, the slow set included
 *   node nettest/run.mjs name...      just these
 *   JOBS=2 node nettest/run.mjs       how many run at once (default 4)
 *
 * Each scenario has its own containers, network and room, so they run in
 * parallel. The slow set waits out real reconnection timers — a network
 * cut for forty seconds, a phone frozen in the background — which only a
 * real browser can measure: run it when connection code changes.
 *
 * plaza is expected beside this repository, as it is for tools/sync-libs.sh.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { scenarios } from './scenarios.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const { build, Run } = await import(path.resolve(here, '../../plaza/nettest/lib.mjs'))

/** Scenarios that wait out real time on purpose. */
const SLOW = new Set(['c4-drop', 'phone-c4'])

const args = process.argv.slice(2)
const all = args.includes('--all')
const named = args.filter((a) => !a.startsWith('--'))
const names = named.length ? named : Object.keys(scenarios).filter((n) => all || !SLOW.has(n))
const jobs = Math.max(1, Number(process.env.JOBS) || 4)

if (!process.env.NOBUILD) build()
fs.mkdirSync(path.join(here, 'results'), { recursive: true })

const begun = Date.now()
let failed = 0

async function runOne(name) {
  const scenario = scenarios[name]
  if (!scenario) { console.error(`no scenario called ${name}`); failed++; return }
  const run = new Run(`recreo-${name}`)
  const started = Date.now()
  let verdict
  let ok = true
  try {
    const result = await scenario(run)
    verdict = `PASS ${name} (${((Date.now() - started) / 1000).toFixed(0)}s) ${JSON.stringify(result)}`
  } catch (err) {
    ok = false
    failed++
    verdict = `FAIL ${name} (${((Date.now() - started) / 1000).toFixed(0)}s): ${err.message}`
  }
  // Each page's own transport log only matters when something went wrong.
  let pages = ''
  if (!ok) {
    for (const label of run.peers.keys()) {
      try { pages += `\n--- ${label} transport log ---\n${(await run.cmd(label, 'tlog 300', 5000)).join('\n')}\n` } catch { /* gone */ }
    }
  }
  const file = path.join(here, 'results', `${run.tag}.log`)
  fs.writeFileSync(file, `${verdict}\n\n${run.timeline()}\n${pages}\n--- everything ---\n${run.timeline(() => true)}\n`)
  console.log(`${verdict}\n  log: ${path.relative(process.cwd(), file)}`)
  if (!process.env.KEEP) run.close()
}

// A small pool: each worker takes the next scenario until none are left.
const queue = [...names]
await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, async () => {
  while (queue.length) await runOne(queue.shift())
}))

const skipped = named.length || all ? 0 : SLOW.size
console.log(`\n${names.length - failed}/${names.length} passed in ${((Date.now() - begun) / 1000).toFixed(0)}s${skipped ? ` — slow set skipped (${[...SLOW].join(', ')}): run with --all` : ''}`)
process.exit(failed ? 1 : 0)
