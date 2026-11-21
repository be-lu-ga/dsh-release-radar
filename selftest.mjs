/**
 * Harness-free checks for lib/client.js.
 *
 * The Client module is a single IIFE that talks to `window.__ModuleLoader__`,
 * so we stub the module loader, a minimal React, and `document`, then render
 * the badge by hand and inspect the returned element tree.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, 'lib', 'client.js'), 'utf8')

let failures = 0
const ok = (condition, label) => {
  if (condition) {
    console.log(`  ok   ${label}`)
  } else {
    failures += 1
    console.log(`  FAIL ${label}`)
  }
}

/* ---------- stubs ---------- */

function makeReact() {
  let cursor = 0
  let overrides = []
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false) }),
    useRef: (initial) => ({ current: initial }),
    useState: (initial) => {
      const index = cursor
      cursor += 1
      const value = index < overrides.length && overrides[index] !== undefined ? overrides[index] : (typeof initial === 'function' ? initial() : initial)
      return [value, () => {}]
    },
    useEffect: () => {},
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
    useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
  }
  return {
    React,
    setOverrides(next) {
      overrides = next
    },
    reset() {
      cursor = 0
    },
  }
}

const state = makeReact()
const styleNodes = []
const documentStub = {
  createElement: (tag) => ({ tag, dataset: {}, textContent: '', remove() {} }),
  head: { appendChild: (node) => styleNodes.push(node) },
  addEventListener() {},
  removeEventListener() {},
}

const registrations = []
const injections = []

const localeStub = {
  registered: null,
  getSnapshot: () => ({ active: 'zh-CN', locales: [], revision: 1 }),
  subscribe: () => () => {},
  register(ns, dicts) {
    localeStub.registered = { ns, dicts }
    return () => {}
  },
}

const slotsStub = {
  inject(key, callback) {
    injections.push(key)
    return callback()
  },
  register(options, Component) {
    registrations.push({ options, Component })
    return () => {}
  },
}

const ctx = {
  effect(fn) {
    const dispose = fn()
    return typeof dispose === 'function' ? dispose : () => {}
  },
  get: (name) => (name === 'locale' ? localeStub : undefined),
  slots: slotsStub,
}

/* ---------- load the module ---------- */

let loaded = null
const windowStub = {
  __ModuleLoader__: {
    load(entry) {
      loaded = entry
    },
  },
}

const run = new Function('window', 'document', 'globalThis', `${source}\nreturn window.__ModuleLoader__;`)
const loader = run(windowStub, documentStub, globalThis)
void loader

console.log('module registration')
ok(loaded !== null, 'registers exactly one module')
ok(loaded?.id === 'dsh-release-radar', 'module id is dsh-release-radar')
ok(typeof loaded?.factory === 'function', 'factory is a function')

const exported = loaded.factory((name) => {
  if (name === 'react') return state.React
  throw new Error(`unexpected require(${name})`)
})

console.log('exports')
ok(exported?.name === 'dsh-release-radar', 'name export')
ok(Array.isArray(exported?.inject) && exported.inject.includes('slots'), "inject includes 'slots'")
ok(typeof exported?.apply === 'function', 'apply is a function')

console.log('apply')
let threw = null
try {
  exported.apply(ctx)
} catch (error) {
  threw = error
}
ok(threw === null, `apply does not throw${threw === null ? '' : ` (${threw.message})`}`)
ok(styleNodes.length === 1 && styleNodes[0].dataset.plugin === 'dsh-release-radar', 'injects one plugin style tag')
ok(/--dsw-alias-/.test(styleNodes[0]?.textContent ?? ''), 'style uses theme tokens')
const css = styleNodes[0]?.textContent ?? ''
const paintProps = /^(color|background|background-color|border|border-color|border-top|border-bottom)$/i
// `var(--token, #fff)` is a token with a fallback, not a hard-coded colour.
const withoutTokens = css.replace(/var\([^()]*\)/g, 'var()')
const literalPaint = withoutTokens
  .split(/[{};]/)
  .map((chunk) => chunk.trim())
  .filter((chunk) => {
    const colon = chunk.indexOf(':')
    if (colon < 0) return false
    return paintProps.test(chunk.slice(0, colon).trim()) && /#[0-9a-f]{3,8}\b|rgba?\(/i.test(chunk.slice(colon + 1))
  })
ok(literalPaint.length === 0, `paint declarations use theme tokens${literalPaint.length === 0 ? '' : ` (${literalPaint[0]})`}`)
ok(localeStub.registered?.ns === 'dsh-release-radar', 'registers a locale namespace')
ok(localeStub.registered?.dicts?.zh !== undefined && localeStub.registered?.dicts?.en !== undefined, 'registers both zh and en dictionaries')
ok(injections.length === 1 && injections[0] === 'shell.overlay', 'injects into shell.overlay')
ok(registrations.length === 1, 'registers one seat')
const seat = registrations[0]
ok(seat?.options?.name === 'shell.overlay', 'seat targets shell.overlay')
ok(seat?.options?.id === 'dsh-release-radar-badge', 'seat id')
ok(typeof seat?.options?.label === 'function' && typeof seat.options.label() === 'string', 'seat label is a thunk')
ok(typeof seat?.Component === 'function', 'seat carries a component')

console.log('apply survives a locale failure')
{
  const throwing = {
    ...localeStub,
    register() {
      throw new Error('namespace already owned')
    },
  }
  const seatsBefore = registrations.length
  const savedGet = ctx.get
  ctx.get = (name) => (name === 'locale' ? throwing : undefined)
  let localThrew = null
  try {
    exported.apply(ctx)
  } catch (error) {
    localThrew = error
  }
  ctx.get = savedGet
  ok(localThrew === null, `a rejected namespace does not break apply${localThrew === null ? '' : ` (${localThrew.message})`}`)
  ok(registrations.length === seatsBefore + 1, 'the seat is still registered without the dictionaries')
}

/* ---------- render ---------- */

const render = (overrides) => {
  state.setOverrides(overrides)
  state.reset()
  return seat.Component()
}

const text = (node) => {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  const own = node.children?.map(text).join('') ?? ''
  return own
}
const walk = (node, out = []) => {
  if (node === null || node === undefined || typeof node !== 'object') return out
  out.push(node)
  node.children?.forEach((child) => walk(child, out))
  return out
}
const byClass = (tree, cls) => walk(tree).filter((node) => String(node.props?.className ?? '').includes(cls))

const report = {
  phase: 'idle',
  checked: 32,
  checkedAt: '2026-11-21T09:11:36.608Z',
  problems: [],
  updates: [
    { name: 'dshmarket', kind: 'registry', installedVersion: '1.73.22', version: '1.74.0', actionable: true },
    { name: 'dsh-context', kind: 'registry', installedVersion: '0.86.0', version: '0.87.0', actionable: true },
    { name: 'dsh-code-nav', kind: 'git', installedVersion: '0.1.0', commit: '0d34d27a391be14b289f687e0c96bae82891c82c', actionable: false },
  ],
}

console.log('idle (no data yet)')
{
  const tree = render([])
  ok(tree !== null, 'renders something')
  ok(byClass(tree, 'dsh-un-badge').length === 0, 'no badge before the first report')
  ok(byClass(tree, 'dsh-un-sr').length === 1, 'live region is always mounted')
}

console.log('updates available, collapsed')
{
  const tree = render([report, false, '', '', '', false, 'zh-CN'])
  const badge = byClass(tree, 'dsh-un-badge')[0]
  ok(badge !== undefined, 'renders a badge')
  ok(byClass(tree, 'dsh-un-dot').length === 1, 'badge carries a dot')
  ok(byClass(tree, 'dsh-un-count')[0] !== undefined && text(byClass(tree, 'dsh-un-count')[0]) === '2', 'counts only actionable updates')
  ok(byClass(tree, 'dsh-un-panel').length === 0, 'panel stays closed')
  ok(text(byClass(tree, 'dsh-un-sr')[0]) === '2 个插件可更新', 'live region announces the count in Chinese')
  ok(String(badge.props['aria-label'] ?? '').includes('2 个插件可更新'), 'badge accessible name carries the count')
}

console.log('panel open')
{
  const tree = render([report, true, '', '', '', false, 'zh-CN'])
  const panel = byClass(tree, 'dsh-un-panel')[0]
  ok(panel !== undefined, 'renders the panel')
  ok(panel?.props?.role === 'dialog', 'panel is a dialog')
  ok(panel?.props?.tabIndex === -1, 'panel is programmatically focusable')
  ok(panel?.props?.['aria-labelledby'] === 'dsh-un-title', 'panel is labelled by its title')
  ok(byClass(tree, 'dsh-un-title')[0]?.props?.id === 'dsh-un-title', 'title carries the label id')
  ok(text(byClass(tree, 'dsh-un-sub')[0]) === '已检查 32 个插件', 'subtitle fills the checked placeholder')

  const all = text(tree)
  ok(all.includes('dshmarket'), 'lists dshmarket')
  ok(all.includes('1.73.22') && all.includes('1.74.0'), 'shows installed and new versions')
  ok(all.includes('重新检查'), 'has a re-check action')

  const rows = byClass(tree, 'dsh-un-row')
  const gitRow = rows.find((row) => text(row).includes('dsh-code-nav'))
  ok(gitRow !== undefined, 'keeps the non-actionable Git update visible')
  ok(gitRow !== undefined && walk(gitRow).filter((n) => n.type === 'button').length === 0, 'no button on a non-actionable row')
  ok(gitRow !== undefined && text(gitRow).includes('来自 Git'), 'explains why the Git row cannot update')

  const registryRow = rows.find((row) => text(row).includes('dshmarket'))
  ok(registryRow !== undefined && walk(registryRow).filter((n) => n.type === 'button').length === 1, 'one button on an actionable row')

  const close = byClass(tree, 'dsh-un-close')[0]
  ok(close?.props?.['aria-label'] === '关闭', 'close button has an accessible name')

  const primary = byClass(tree, 'dsh-un-primary')[0]
  ok(primary?.props?.disabled === false || primary?.props?.disabled === undefined, 'primary action is enabled when idle')
}

console.log('english')
{
  const tree = render([report, false, '', '', '', false, 'en-US'])
  ok(text(byClass(tree, 'dsh-un-sr')[0]) === '2 plugin updates available', 'switches to English copy')
}

console.log('failure surfacing')
{
  const tree = render([{ ...report, phase: 'failed', error: 'registry unreachable', updates: [] }, false, '', '', '', false, 'zh-CN'])
  const badge = byClass(tree, 'dsh-un-badge')[0]
  ok(badge !== undefined, 'badge appears when the check fails')
  ok(badge?.props?.['data-tone'] === 'error', 'failure badge is marked as an error')

  const open = render([{ ...report, phase: 'failed', error: 'registry unreachable', updates: [] }, true, '', '', '', false, 'zh-CN'])
  ok(text(open).includes('registry unreachable'), 'panel shows the host error text')
}

console.log('update failure banner')
{
  // The banner is the only place an update refusal surfaces, so it has to name
  // the plugin and the reason: the same bare "update failed" for every cause is
  // what made the real failure impossible to identify.
  const tree = render([report, true, '', '', '更新失败：dsh-drawai — update failed', false, 'zh-CN'])
  const banner = byClass(tree, 'dsh-un-banner')[0]
  ok(banner?.props?.['data-tone'] === 'err', 'a failed update uses the error tone')
  ok(text(tree).includes('dsh-drawai'), 'the banner names the plugin that failed')
  ok(text(tree).includes('update failed'), 'the banner carries the host reason')
}

console.log('notice after update')
{
  const tree = render([{ ...report, updates: [] }, true, '', 'dshmarket 已更新到 1.74.0。更新完成，可能需要重启 DSH 才会生效。', '', false, 'zh-CN'])
  ok(tree !== null, 'panel survives an empty update list right after an update')
  const banner = byClass(tree, 'dsh-un-banner')[0]
  ok(banner?.props?.['data-tone'] === 'ok', 'success notice uses the success tone')
  ok(text(tree).includes('dshmarket 已更新到 1.74.0'), 'notice names the updated plugin and version')
  ok(text(tree).includes('可能需要重启'), 'restart hint is visible')

  const quiet = render([{ ...report, updates: [] }, true, '', 'dshmarket 已更新到 1.74.0。', '', false, 'zh-CN'])
  ok(!text(quiet).includes('重启'), 'no restart hint when the host reports none')
}

console.log('offline')
{
  const tree = render([report, false, '', '', '', true, 'zh-CN'])
  const badge = byClass(tree, 'dsh-un-badge')[0]
  ok(badge !== undefined, 'badge still renders while the host is unreachable')
  ok(badge?.props?.['data-tone'] === 'normal', 'keeps the update tone when updates are known')
}

console.log('busy state')
{
  const tree = render([report, true, 'dshmarket', '', '', false, 'zh-CN'])
  const row = byClass(tree, 'dsh-un-row').find((r) => text(r).includes('dshmarket'))
  ok(row !== undefined && text(row).includes('更新中'), 'the row being updated says so')
  const panel = byClass(tree, 'dsh-un-panel')[0]
  ok(panel?.props?.['aria-busy'] === true, 'panel marks itself busy')
}

console.log(failures === 0 ? '\nall client checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
