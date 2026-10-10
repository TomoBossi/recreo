import { test, assert } from './harness.js'

const IMPORT = /(?:^|[;\n])\s*(?:import|export)\s+(?:[\w*{}\s,$]+?\s+from\s+)?['"]([^'"]+)['"]/g

test('index.html preloads exactly the modules the room imports at start', async () => {
  // The page names every module up front so the browser fetches them all at
  // once; a module added or dropped without updating that list is caught here.
  const pageUrl = new URL('../index.html', import.meta.url)
  const page = await fetch(pageUrl).then((r) => r.text())
  const map = JSON.parse(page.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports
  const listed = [...page.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map((m) => new URL(m[1], pageUrl).href)

  const found = []
  const walk = async (url) => {
    if (found.includes(url)) return
    found.push(url)
    const src = (await fetch(url).then((r) => r.text())).replace(/\/\*[\s\S]*?\*\//g, '')
    for (const [, spec] of src.matchAll(IMPORT)) await walk(spec in map ? new URL(map[spec], pageUrl).href : new URL(spec, url).href)
  }
  await walk(new URL('../app/main.js', import.meta.url).href)

  const short = (urls) => urls.map((u) => u.slice(new URL('../', import.meta.url).href.length))
  const missing = found.filter((u) => !listed.includes(u))
  const extra = listed.filter((u) => !found.includes(u))
  assert.ok(!missing.length && !extra.length, `index.html's preload list is out of date${missing.length ? `\nmissing: ${short(missing).join(' ')}` : ''}${extra.length ? `\nnot imported: ${short(extra).join(' ')}` : ''}`)
})
