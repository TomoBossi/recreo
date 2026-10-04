/**
 * The smallest test runner that will do: test() files a test, assert checks
 * strictly, run() runs everything filed and reports. It runs in the browser,
 * where the code it tests runs — open test/ in any browser, or see
 * tools/test.sh for the terminal.
 */
const tests = []

export function test(name, fn) {
  tests.push({ name, fn })
}

class AssertionError extends Error {
  constructor(message, detail) {
    super(detail ? `${message}\n${detail}` : message)
    this.name = 'AssertionError'
  }
}

const show = (v) => {
  try { return JSON.stringify(v) } catch { return String(v) }
}

/** Strict structural equality: same types, same keys, same values, all the way down. */
function same(a, b) {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false
  if (Array.isArray(a)) return a.length === b.length && a.every((v, i) => same(v, b[i]))
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((k) => Object.hasOwn(b, k) && same(a[k], b[k]))
}

export const assert = {
  ok(value, message) {
    if (!value) throw new AssertionError(message ?? 'expected something truthy', `got ${show(value)}`)
  },
  equal(actual, expected, message) {
    if (!Object.is(actual, expected)) throw new AssertionError(message ?? 'not equal', `${show(actual)} !== ${show(expected)}`)
  },
  notEqual(actual, expected, message) {
    if (Object.is(actual, expected)) throw new AssertionError(message ?? 'expected a difference', `both ${show(actual)}`)
  },
  deepEqual(actual, expected, message) {
    if (!same(actual, expected)) throw new AssertionError(message ?? 'not deeply equal', `got      ${show(actual)}\nexpected ${show(expected)}`)
  },
  match(text, pattern, message) {
    if (!pattern.test(text)) throw new AssertionError(message ?? `does not match ${pattern}`, `got ${show(text)}`)
  },
  throws(fn, pattern, message) {
    try { fn() } catch (err) {
      if (pattern && !pattern.test(err.message)) throw new AssertionError(message ?? `threw, but not ${pattern}`, err.message)
      return
    }
    throw new AssertionError(message ?? 'expected it to throw')
  },
}

/** Run every test filed so far, in order: [{ name, ok, error, ms }]. */
export async function run() {
  const results = []
  for (const { name, fn } of tests) {
    const t0 = performance.now()
    try {
      await fn()
      results.push({ name, ok: true, ms: performance.now() - t0 })
    } catch (error) {
      results.push({ name, ok: false, error, ms: performance.now() - t0 })
    }
  }
  return results
}
