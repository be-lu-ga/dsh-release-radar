/**
 * Host half of dsh-release-radar.
 *
 * Sweeps the profile's third-party bundles for newer releases (npm registry),
 * keeps the last report in memory, and exposes a same-origin JSON endpoint that
 * the Client half renders as a floating overlay badge.
 *
 * Nothing is installed without an explicit confirm call from the UI.
 */
import { execFile } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const name = 'release-radar'

/** Everything else is resolved optionally so the plugin never blocks boot. */
export const inject = []

const DEFAULT_INTERVAL_HOURS = 24
const DEFAULT_START_DELAY_MS = 3_000
const MIN_INTERVAL_HOURS = 1
const MAX_INTERVAL_HOURS = 24 * 14
const SWEEP_CONCURRENCY = 6
const GIT_TIMEOUT_MS = 20_000
const MAX_BODY_BYTES = 64 * 1024
const ROUTE_PREFIX = '/dsh-release-radar'
const FULL_COMMIT = /^[0-9a-f]{40}$/i

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Plain-language text for the `ManagementError.code` values updateBundle can
 * return. Several of them carry no `diagnostic` at all, so without this map the
 * panel would show a bare code (or nothing) instead of a reason.
 */
const FAILURE_TEXT = {
  'management-required': 'this plugin manages other plugins and cannot update itself',
  unaddressable: 'this plugin cannot be addressed by name',
  'unknown-plugin': 'this plugin is no longer installed',
  'invalid-spec': 'that version cannot be installed for this plugin',
  'already-installed': 'that version is already installed',
  'ambiguous-install': 'more than one installed package matches this name',
  'not-bundle': 'the new version does not declare a DSH bundle',
  'not-removable': 'this plugin cannot be removed while the profile runs',
  'stop-profile': 'the profile would have to stop before this update',
  'bundle-in-use': 'another plugin is still using this one',
  'stale-approval': 'the pending build approval went out of date',
  'incompatible-version': 'the new version does not support this DSH release',
  'unsupported-platform': 'this platform is not supported',
  'unexpected-package': 'the install left an unexpected package behind',
  'operation-error': 'the package manager reported an error',
}

/** `name@version needs <requirements> (running <runtime>)`, for the incompatible list. */
function incompatibleText(list) {
  return list
    .map((item) => {
      const needs = Object.entries(item?.requirements ?? {})
        .map(([key, value]) => `${key} ${value}`)
        .join(', ')
      const version = typeof item?.version === 'string' ? `@${item.version}` : ''
      const running = typeof item?.runtimeVersion === 'string' ? ` (running ${item.runtimeVersion})` : ''
      return `${item?.name ?? 'plugin'}${version}${needs === '' ? '' : ` needs ${needs}`}${running}`
    })
    .filter((line) => line !== '')
    .join('; ')
}

/**
 * The last few non-empty lines of a tool's output: enough to name a cause
 * without pasting a whole pnpm log into a one-line banner.
 */
function tailText(output, limit = 3) {
  const lines = String(output ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
  if (lines.length === 0) return ''
  return lines.slice(-limit).join(' ')
}

/**
 * Turns a settled `ChangeResult` into a sentence a person can act on.
 *
 * `updateBundle` resolves on a refusal as well as on a successful install, and
 * its `result.error` is always an OBJECT (`{ code, diagnostic?, incompatible? }`),
 * never a string. Reading it as a string silently collapses every distinct
 * failure into the same "update failed", which is what made this panel
 * undiagnosable.
 */
export function describeFailure(result) {
  const error = result?.error ?? {}
  const diagnostic = typeof error.diagnostic === 'string' ? error.diagnostic.trim() : ''
  // A diagnostic is usually the useful sentence, but for a failed install it is
  // the entire package-manager output; keep only its tail in that case.
  if (diagnostic !== '') return diagnostic.includes('\n') ? tailText(diagnostic) : diagnostic
  const incompatible = incompatibleText(
    Array.isArray(error.incompatible) ? error.incompatible : effectIncompatible(result),
  )
  if (incompatible !== '') return incompatible
  const output = tailText(result?.packageResult?.output)
  if (output !== '') return output
  // What the last run could not reach is more specific than the generic code
  // it failed with, so it is consulted first.
  if (typeof result?.failedAt === 'string') {
    return result.failedAt === 'spec-host'
      ? 'the Git host could not be reached'
      : 'the registry could not be reached'
  }
  const known = FAILURE_TEXT[error.code]
  if (known !== undefined) return known
  return ''
}

/** `packageResult.incompatible` is populated when the compatibility check refused a run. */
function effectIncompatible(result) {
  const list = result?.packageResult?.incompatible
  return Array.isArray(list) ? list : []
}

function normalized(raw) {
  const hours = Number(raw?.intervalHours)
  const delay = Number(raw?.startDelayMs)
  return {
    intervalHours: Number.isFinite(hours)
      ? Math.min(MAX_INTERVAL_HOURS, Math.max(MIN_INTERVAL_HOURS, hours))
      : DEFAULT_INTERVAL_HOURS,
    startDelayMs: Number.isFinite(delay) ? Math.max(0, delay) : DEFAULT_START_DELAY_MS,
    includePrerelease: raw?.includePrerelease === true,
    // Opt-in: the Client half POSTs a rendering report only while this is on,
    // so the diagnostic channel costs nothing in normal use.
    diagnostics: raw?.diagnostics === true,
  }
}

/* ------------------------------------------------------------------ versions */

function parseVersion(value) {
  const [core = '', pre = ''] = String(value).split('+')[0].split('-')
  const numbers = core.split('.').map((part) => Number.parseInt(part, 10) || 0)
  while (numbers.length < 3) numbers.push(0)
  return { numbers, pre }
}

/** Numeric compare so 0.4.9 < 0.4.10 and 1.0.0-rc.1 < 1.0.0. */
export function compareVersions(left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  for (let index = 0; index < 3; index += 1) {
    if (a.numbers[index] !== b.numbers[index]) return a.numbers[index] < b.numbers[index] ? -1 : 1
  }
  if (a.pre === b.pre) return 0
  if (a.pre === '') return 1
  if (b.pre === '') return -1
  return a.pre < b.pre ? -1 : 1
}

export function isPrerelease(version) {
  return String(version).includes('-')
}

function newestRegistryVersion(versions, installed, includePrerelease) {
  let best
  for (const entry of versions) {
    const version = entry?.version
    if (typeof version !== 'string') continue
    if (entry.incompatible !== undefined) continue
    if (!includePrerelease && isPrerelease(version)) continue
    if (compareVersions(version, installed) <= 0) continue
    if (best === undefined || compareVersions(version, best.version) > 0) best = entry
  }
  return best
}

/* ------------------------------------------------------------- source shapes */

/**
 * Classify a saved dependency spec the same way the plugin manager does.
 * `link:`/`file:` are local and never updatable; a Git spec only counts as
 * updatable when the installed source pins a full commit.
 */
export function classifySource(source) {
  if (typeof source !== 'string' || source === '') return { channel: 'unknown' }
  if (source.startsWith('link:') || source.startsWith('file:')) return { channel: 'local' }
  if (/^(github|gitlab|bitbucket|gist):/i.test(source) || /^(git\+|git@)/i.test(source)) {
    const hash = source.indexOf('#')
    const commit = hash === -1 ? '' : source.slice(hash + 1).split('&')[0]
    return FULL_COMMIT.test(commit) ? { channel: 'git', commit } : { channel: 'git-unpinned' }
  }
  if (/^https?:\/\/[^/]+\/[^/]+\/[^/]+/.test(source)) {
    const hash = source.indexOf('#')
    const commit = hash === -1 ? '' : source.slice(hash + 1).split('&')[0]
    return FULL_COMMIT.test(commit) ? { channel: 'git', commit } : { channel: 'git-unpinned' }
  }
  const at = source.lastIndexOf('@')
  const range = at <= 0 ? '' : source.slice(at + 1)
  const packageName = at <= 0 ? source : source.slice(0, at)
  if (range.includes(':')) return { channel: 'unknown' }
  return { channel: 'registry', packageName, range }
}

/* ------------------------------------------------------------ profile dir */

/**
 * Locate the profile directory.
 *
 * The host process does not export DSH_* variables (they exist only in the
 * session shell), so probe the usual roots and pick the profile whose manifest
 * already depends on this package.
 */
export function resolveProfileDir(env = process.env, homeDir = homedir()) {
  const tried = []
  const roots = []
  if (typeof env.DSH_PROFILE_DIR === 'string' && env.DSH_PROFILE_DIR !== '') {
    return { dir: env.DSH_PROFILE_DIR, how: 'DSH_PROFILE_DIR', tried }
  }
  if (typeof env.DSH_HOME === 'string' && env.DSH_HOME !== '') roots.push({ home: env.DSH_HOME, how: 'DSH_HOME' })
  try {
    roots.push({ home: join(homeDir, '.dsh'), how: 'homedir/.dsh' })
  } catch {
    /* no home directory */
  }

  for (const root of roots) {
    const profilesRoot = join(root.home, 'profiles')
    const name = typeof env.DSH_PROFILE === 'string' ? env.DSH_PROFILE : ''
    if (name !== '') {
      const direct = join(profilesRoot, name)
      try {
        if (readFileSync(join(direct, 'package.json'), 'utf8') !== '') {
          return { dir: direct, how: `${root.how} + DSH_PROFILE=${name}`, tried }
        }
      } catch (error) {
        tried.push(`${direct}: ${messageOf(error)}`)
      }
    }
    let entries
    try {
      entries = readdirSync(profilesRoot, { withFileTypes: true })
    } catch (error) {
      tried.push(`${profilesRoot}: ${messageOf(error)}`)
      continue
    }
    for (const entry of entries) {
      if (entry.isDirectory() !== true) continue
      const candidate = join(profilesRoot, entry.name)
      try {
        const manifest = JSON.parse(readFileSync(join(candidate, 'package.json'), 'utf8'))
        if (manifest.dependencies?.['dsh-release-radar'] !== undefined) {
          return { dir: candidate, how: `${root.how} scan matched ${entry.name}`, tried }
        }
      } catch {
        /* not a profile */
      }
    }
    tried.push(`${profilesRoot}: no profile depends on dsh-release-radar`)
  }
  return { dir: '', how: 'not found', tried }
}

/* --------------------------------------------------------------- lockfile */

/**
 * Read the commit each Git dependency actually resolved to.
 * Installed manifests leave `gitHead` empty, so the lockfile is the only
 * truthful source for "what am I running right now".
 */
export function readPinnedCommits(profileDir) {
  const pins = new Map()
  let text
  try {
    text = readFileSync(join(profileDir, 'pnpm-lock.yaml'), 'utf8')
  } catch {
    return pins
  }
  let current = ''
  for (const line of text.split(/\r?\n/)) {
    const key = /^ {4,8}(?:'([^']+)'|"([^"]+)"|([^\s'":][^'":]*)):\s*$/.exec(line)
    if (key !== null) {
      current = (key[1] ?? key[2] ?? key[3] ?? '').trim()
      continue
    }
    if (!/^\s+version:\s*\S+/.test(line)) continue
    if (current === '') continue
    const resolved = /^\s+version:\s*(\S+)/.exec(line)[1]
    const sha = /\/tar\.gz\/([0-9a-f]{40})/i.exec(resolved)
    if (sha !== null) pins.set(current, { commit: sha[1].toLowerCase(), url: resolved })
  }
  return pins
}

/** Map a bundle name to its clone URL using the profile manifest. */
export function readGitDependencies(profileDir) {
  const remotes = new Map()
  let manifest
  try {
    manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
  } catch {
    return remotes
  }
  for (const [bundleName, spec] of Object.entries(manifest.dependencies ?? {})) {
    const value = String(spec)
    const github = /^(?:github:|git\+https:\/\/github\.com\/)([^/#]+)\/([^/#]+?)(?:\.git)?(?:#.*)?$/.exec(value)
    if (github !== null) {
      remotes.set(bundleName, `https://github.com/${github[1]}/${github[2]}`)
      continue
    }
    const plain = /^https?:\/\/(?:[^@/]+@)?([^/:]+)[/:]([^/#]+)\/([^/#]+?)(?:\.git)?(?:#.*)?$/.exec(value)
    if (plain !== null) remotes.set(bundleName, `https://${plain[1]}/${plain[2]}/${plain[3]}`)
  }
  return remotes
}

/**
 * Ask the remote for its HEAD commit.
 *
 * The child gets a scrubbed environment so a hung credential helper can never
 * block the sweep, but `execFile` has to find git first: a bare 'git' relies on
 * the host process having it on PATH, which is not guaranteed for a desktop app
 * launched from a shortcut. The failure therefore reports the exit code and
 * stderr instead of a bare "Command failed".
 */
function remoteHead(repository) {
  return new Promise((resolve) => {
    execFile(
      process.env.DSH_GIT ?? 'git',
      ['-c', 'core.askPass=', 'ls-remote', '--exit-code', '--', repository, 'HEAD'],
      {
        timeout: GIT_TIMEOUT_MS,
        windowsHide: true,
        env: {
          PATH: process.env.PATH ?? '',
          Path: process.env.Path ?? process.env.PATH ?? '',
          SystemRoot: process.env.SystemRoot ?? '',
          windir: process.env.windir ?? process.env.SystemRoot ?? '',
          COMSPEC: process.env.COMSPEC ?? '',
          PATHEXT: process.env.PATHEXT ?? '',
          HOME: process.env.HOME ?? process.env.USERPROFILE ?? '',
          USERPROFILE: process.env.USERPROFILE ?? '',
          APPDATA: process.env.APPDATA ?? '',
          LOCALAPPDATA: process.env.LOCALAPPDATA ?? '',
          TEMP: process.env.TEMP ?? '',
          TMP: process.env.TMP ?? '',
          LC_ALL: 'C',
          GIT_TERMINAL_PROMPT: '0',
          GCM_INTERACTIVE: 'never',
          GIT_ASKPASS: '',
          SSH_ASKPASS: '',
          SSH_ASKPASS_REQUIRE: 'never',
        },
      },
      (error, stdout, stderr) => {
        if (error) {
          const code = typeof error.code === 'number' || typeof error.code === 'string' ? ` (${error.code})` : ''
          const detail = String(stderr ?? '').trim().split('\n')[0] ?? ''
          resolve({
            ok: false,
            reason: detail === '' ? `${messageOf(error)}${code}` : `${detail}${code}`,
          })
          return
        }
        const sha = /^([0-9a-f]{40})\s/m.exec(String(stdout))
        resolve(sha === null ? { ok: false, reason: 'no HEAD in ls-remote output' } : { ok: true, commit: sha[1] })
      },
    )
  })
}

/* -------------------------------------------------------------------- sweep */

/**
 * The queue a one-click batch will work through.
 *
 * Exported and pure because the copy is load-bearing: a sweep partway through
 * the loop replaces `state.updates` wholesale, and iterating that live array
 * would skip whatever moved into the slot just consumed. Snapshotting first also
 * freezes the version each row targets, so a mid-batch refresh cannot retarget
 * an install that has not started yet.
 */
export function bulkQueue(updates) {
  if (!Array.isArray(updates)) return []
  return updates
    .filter((entry) => entry !== null && typeof entry === 'object' && entry.actionable === true)
    .map((entry) => ({ ...entry }))
}

/**
 * Compare every third-party profile bundle against its release channel.
 * A failing package degrades to a per-bundle `problem`; the sweep never throws.
 */
export async function collectUpdates(pluginManager, profileDir, options) {
  const bundles = await pluginManager.listBundles()
  const candidates = bundles.filter(
    (bundle) =>
      bundle.availability === 'profile' &&
      bundle.installed === true &&
      bundle.official !== true &&
      bundle.readOnlyReason === undefined,
  )
  const pins = readPinnedCommits(profileDir)
  const remotes = readGitDependencies(profileDir)
  const updates = []
  const problems = []
  let checked = 0

  // Each registry probe shells out to `pnpm view`, which dominates the whole
  // sweep. Probing serially made a cold sweep take long enough that the badge
  // looked missing after a restart, so the work runs in a bounded pool instead.
  const probes = []

  for (const bundle of candidates) {
    const installed = bundle.version ?? bundle.installTarget?.version
    const shape = classifySource(bundle.source)
    if (shape.channel === 'local') continue
    if (typeof installed !== 'string' || installed === '') {
      problems.push({ name: bundle.name, problem: 'no installed version' })
      continue
    }

    if (shape.channel === 'registry') {
      checked += 1
      probes.push(async () => {
        let listing
        try {
          listing = await pluginManager.listVersions(bundle.name)
        } catch (error) {
          problems.push({ name: bundle.name, problem: messageOf(error) })
          return
        }
        if (listing.status !== 'listed') {
          problems.push({ name: bundle.name, problem: listing.problem, reason: listing.reason })
          return
        }
        const newest = newestRegistryVersion(listing.versions, installed, options.includePrerelease)
        if (newest !== undefined) {
          updates.push({
            name: bundle.name,
            kind: 'registry',
            actionable: true,
            installedVersion: installed,
            version: newest.version,
            publishedAt: newest.publishedAt,
          })
        }
      })
      continue
    }

    probes.push(() => probeGit(bundle, remotes, pins, installed, updates, problems))
  }

  for (let index = 0; index < probes.length; index += SWEEP_CONCURRENCY) {
    await Promise.all(probes.slice(index, index + SWEEP_CONCURRENCY).map((probe) => probe()))
  }
  checked = candidates.filter((bundle) => classifySource(bundle.source).channel !== 'local').length
  // Stable order so the panel does not reshuffle between sweeps.
  updates.sort((left, right) => left.name.localeCompare(right.name))
  problems.sort((left, right) => left.name.localeCompare(right.name))
  return { updates, problems, checked, candidates: candidates.length, total: bundles.length }
}

async function probeGit(bundle, remotes, pins, installed, updates, problems) {
  const remote = remotes.get(bundle.name)
  const pin = pins.get(bundle.name)
  if (remote === undefined) {
    problems.push({ name: bundle.name, problem: 'git origin not found in profile manifest' })
    return
  }
  if (pin === undefined) {
    problems.push({ name: bundle.name, problem: 'pinned commit not found in pnpm-lock.yaml' })
    return
  }
  const head = await remoteHead(remote)
  if (!head.ok) {
    problems.push({ name: bundle.name, problem: 'git', reason: head.reason })
    return
  }
  const commit = head.commit.toLowerCase()
  if (commit === pin.commit) return
  const shape = classifySource(bundle.source)
  updates.push({
    name: bundle.name,
    kind: 'git',
    // The profile pins `owner/repo` without a commit, so the plugin manager
    // refuses to replace it; report it, but do not offer a broken button.
    actionable: shape.channel === 'git' && shape.commit === pin.commit,
    installedVersion: installed,
    commit,
    previousCommit: pin.commit,
    spec: `${remote}#${commit}`,
  })
}

/* ------------------------------------------------------------------- cache */

function cachePath(profileDir) {
  if (profileDir === '') return undefined
  return join(profileDir, '.dsh-release-radar.json')
}

function readCache(file) {
  if (file === undefined) return undefined
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    if (parsed === null || typeof parsed !== 'object') return undefined
    if (!Array.isArray(parsed.updates)) return undefined
    return {
      updates: parsed.updates,
      problems: Array.isArray(parsed.problems) ? parsed.problems : [],
      checked: typeof parsed.checked === 'number' ? parsed.checked : 0,
      checkedAt: typeof parsed.checkedAt === 'string' ? parsed.checkedAt : undefined,
    }
  } catch {
    return undefined
  }
}

function writeCache(file, state) {
  if (file === undefined) return
  try {
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, JSON.stringify({
      updates: state.updates,
      problems: state.problems,
      checked: state.checked,
      checkedAt: state.checkedAt,
    }))
  } catch {
    /* a failed cache write must never break a sweep */
  }
}

/* ------------------------------------------------------------------- routes */

function writeJson(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(body))
}

async function readJsonBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (size === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/** Loopback-only guard: the report never leaves this host. */
function isTrusted(request, trustedHosts) {
  const raw = request.headers.host
  if (typeof raw !== 'string') return false
  let host
  try {
    host = new URL(`http://${raw}`).hostname
  } catch {
    return false
  }
  const loopback = host === '127.0.0.1' || host === '::1' || host === 'localhost'
  if (!loopback && !trustedHosts.includes(host)) return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (typeof origin === 'string' && origin !== '') {
    try {
      if (new URL(origin).hostname !== host) return false
    } catch {
      return false
    }
  }
  return true
}

/* -------------------------------------------------------------------- apply */

export function apply(ctx, config) {
  const options = normalized(config)
  const log = ctx.logger ?? console

  const state = {
    phase: 'idle',
    checkedAt: undefined,
    updates: [],
    problems: [],
    checked: 0,
    running: false,
    applying: undefined,
    // Progress of a one-click batch, so the panel can show "2/5" while the
    // serial loop runs instead of a button that looks hung for a minute.
    bulk: undefined,
    error: undefined,
    profileDir: '',
    // Diagnostics: how many times the panel asked for the report, and when it
    // last did. A rising count with no badge on screen means the page is
    // fetching but the component is not rendering; a flat count means the
    // Client half never mounted at all.
    reads: 0,
    lastReadAt: undefined,
  }

  ctx.inject(['pluginManager', 'webServer'], (scoped) => {
    const pluginManager = scoped.pluginManager
    const webServer = scoped.webServer
    const resolved = resolveProfileDir(process.env)
    const profileDir = resolved.dir
    state.profileDir = profileDir
    state.profileHow = resolved.how
    state.env = {
      DSH_PROFILE: process.env.DSH_PROFILE,
      DSH_HOME: process.env.DSH_HOME,
      DSH_PROFILE_DIR: process.env.DSH_PROFILE_DIR,
    }
    const trustedHosts = scoped.get('webRuntime')?.trustedHosts ?? []
    state.intervalHours = options.intervalHours
    state.startDelayMs = options.startDelayMs
    state.diagnostics = options.diagnostics
    let disposed = false

    // Restore the previous report so a restart does not leave the badge blank
    // while the first (cold) sweep is still asking the registry. A stale report
    // is still far more useful than no badge at all, and the sweep replaces it
    // as soon as it lands.
    const cacheFile = cachePath(profileDir)
    const restored = readCache(cacheFile)
    if (restored !== undefined) {
      state.updates = restored.updates
      state.problems = restored.problems
      state.checked = restored.checked
      state.checkedAt = restored.checkedAt
      state.cached = true
    }

    const sweep = async () => {
      if (state.running || profileDir === '' || disposed) return state
      state.running = true
      state.phase = 'checking'
      state.error = undefined
      try {
        const report = await collectUpdates(pluginManager, profileDir, options)
        state.updates = report.updates
        state.problems = report.problems
        state.checked = report.checked
        state.candidates = report.candidates
        state.checkedAt = new Date().toISOString()
        state.phase = 'idle'
        state.cached = false
        writeCache(cacheFile, state)
      } catch (error) {
        state.phase = 'failed'
        state.error = messageOf(error)
        log.warn?.(`[release-radar] sweep failed: ${state.error}`)
      } finally {
        state.running = false
      }
      log.info?.(`[release-radar] ${state.updates.length}/${state.checked} bundles have newer releases`)
      return state
    }

    const applyUpdate = async (name, target, { resweep = true } = {}) => {
      state.applying = name
      try {
        const outcome = target.kind === 'git'
          ? await pluginManager.updateBundle(name, target.version, { spec: target.spec })
          : await pluginManager.updateBundle(name, target.version)
        // updateBundle RESOLVES on a refusal too: a rejected version, an
        // incompatible manifest or a rollback all come back as a normal result
        // carrying application:'failed'|'cancelled'. Reporting that as success
        // would be a lie, so the outcome is inspected rather than assumed.
        const application = outcome.result?.application
        const trouble = application === 'failed' || application === 'cancelled'
        if (resweep) await sweep()
        if (trouble) {
          const code = outcome.result?.error?.code
          const reason = describeFailure(outcome.result)
          return {
            ok: false,
            name,
            application,
            step: outcome.step,
            // `error` stays a display string for the banner; the structured
            // fields below let the panel (and a bug report) say exactly which
            // stage failed and where the manager's own log lives.
            error: reason !== ''
              ? reason
              : application === 'cancelled'
                ? 'update cancelled'
                : 'update failed',
            code: typeof code === 'string' ? code : undefined,
            stage: outcome.result?.stage,
            failedAt: outcome.result?.failedAt,
            from: outcome.from,
            to: outcome.to,
            logPath: outcome.result?.packageResult?.logPath,
            restore: outcome.restore?.application,
          }
        }
        return {
          ok: true,
          name,
          step: outcome.step,
          application,
          restartReason: outcome.result?.restartReason,
        }
      } catch (error) {
        return { ok: false, name, error: messageOf(error) }
      } finally {
        state.applying = undefined
      }
    }

    /**
     * Install every pending update, one after another.
     *
     * The manager has no batch entry point, so this is a serial loop over the
     * same applyUpdate() a single row uses. Two deliberate choices:
     *  - the queue is snapshotted first, because a sweep mid-loop rewrites
     *    state.updates and iterating the live array would skip entries;
     *  - the fleet is re-scanned once at the end instead of after each
     *    install, which would add a registry round trip per plugin.
     * One failure never aborts the batch: an incompatible release says
     * nothing about the next one, so the rest still get their chance.
     */
    const applyAll = async () => {
      const queue = bulkQueue(state.updates)
      const summary = {
        total: queue.length,
        done: 0,
        ok: 0,
        failed: 0,
        running: queue.length > 0,
        startedAt: new Date().toISOString(),
      }
      state.bulk = summary
      const results = []
      try {
        for (const entry of queue) {
          if (disposed) break
          state.bulk.current = entry.name
          // eslint-disable-next-line no-await-in-loop
          const result = await applyUpdate(entry.name, entry, { resweep: false })
          results.push(result)
          state.bulk.done += 1
          if (result.ok === true) state.bulk.ok += 1
          else state.bulk.failed += 1
        }
      } finally {
        state.bulk.current = undefined
        state.bulk.running = false
        state.bulk.finishedAt = new Date().toISOString()
        // The panel polls the same state object, so the per-plugin verdicts have
        // to live there: by the time the batch ends the request that started it
        // has already been answered.
        state.bulk.results = results
        await sweep()
      }
      return { ok: summary.failed === 0, results, bulk: state.bulk }
    }

    let timer
    let stopped = false
    const schedule = (delay) => {
      if (stopped) return
      state.nextCheckAt = new Date(Date.now() + delay).toISOString()
      timer = setTimeout(() => {
        void sweep()
        schedule(options.intervalHours * 3_600_000)
      }, delay)
      timer.unref?.()
    }
    schedule(options.startDelayMs)
    const stopSchedule = () => {
      stopped = true
      state.nextCheckAt = undefined
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
    }

    const stopRoute = webServer.register({
      kind: 'exact',
      path: `${ROUTE_PREFIX}/state`,
      handler: async (request, response) => {
        if (!isTrusted(request, trustedHosts)) {
          writeJson(response, 403, { error: 'forbidden' })
          return
        }
        if (request.method === 'POST') {
          let body
          try {
            body = await readJsonBody(request)
          } catch (error) {
            writeJson(response, 400, { error: messageOf(error) })
            return
          }
          if (body.action === 'check') {
            await sweep()
          } else if (body.action === 'update') {
            const target = state.updates.find((entry) => entry.name === body.name)
            if (target === undefined) {
              writeJson(response, 404, { error: 'no such pending update' })
              return
            }
            if (target.actionable !== true) {
              writeJson(response, 409, { error: 'this source cannot be updated automatically' })
              return
            }
            const result = await applyUpdate(body.name, target)
            // A refusal resolves normally on the host: the request was handled,
            // there is just nothing to install. Answering 500 made the read side
            // throw before it could render `body.error`, so the banner lost both
            // the plugin name and the reason. The request itself only fails with
            // a real exception, which applyUpdate already reports as ok:false.
            writeJson(response, 200, { ...result, state })
            return
          } else if (body.action === 'updateAll') {
            // A second batch while one is running would fight the first over
            // the same packages; refuse instead of queueing.
            if (state.bulk?.running === true) {
              writeJson(response, 409, { error: 'an update is already running' })
              return
            }
            const pending = bulkQueue(state.updates)
            if (pending.length === 0) {
              writeJson(response, 200, { ok: true, started: false, results: [], skipped: true, state })
              return
            }
            // Answer at once instead of awaiting the batch: installing five
            // bundles can outlast the server's request timeout, and a client
            // timeout on a run that actually succeeded reads as a failure. The
            // panel already polls this same state, so it follows `bulk` instead.
            applyAll().catch((error) => {
              log.warn?.(`[release-radar] bulk update failed: ${messageOf(error)}`)
            })
            writeJson(response, 200, { ok: true, started: true, total: pending.length, state })
            return
          } else if (body.action === 'probe') {
            // The Client half reports what it actually rendered, so a badge
            // that is mounted-but-invisible can be told apart from one that
            // never got data.
            state.probe = {
              at: new Date().toISOString(),
              ...(typeof body.probe === 'object' && body.probe !== null ? body.probe : {}),
            }
            writeJson(response, 200, { ok: true })
            return
          }
        }
        // Only the plain report read counts as a panel poll.
        state.reads += 1
        state.lastReadAt = new Date().toISOString()
        writeJson(response, 200, state)
      },
    })

    return () => {
      disposed = true
      stopSchedule()
      if (typeof stopRoute === 'function') stopRoute()
    }
  })
}
