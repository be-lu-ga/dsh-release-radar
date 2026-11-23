/**
 * Headless self-test for the Host half's pure logic.
 *
 * The Host half only exports pure helpers plus `apply`, so importing it here
 * costs nothing: no Cordis context is touched until apply() runs.
 *
 * Run: node host-test.mjs
 */
import {
  bulkQueue,
  classifySource,
  compareVersions,
  describeFailure,
  isPrerelease,
  readGitDependencies,
  readPinnedCommits,
  resolveProfileDir,
} from './lib/index.js'

let failures = 0
const check = (label, condition, detail = '') => {
  if (condition) {
    console.log(`  ok   ${label}`)
  } else {
    failures += 1
    console.log(`  FAIL ${label}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

console.log('compareVersions')
check('0.4.9 < 0.4.10 (numeric, not lexicographic)', compareVersions('0.4.9', '0.4.10') === -1)
check('1.73.22 < 1.74.0', compareVersions('1.73.22', '1.74.0') === -1)
check('same version compares equal', compareVersions('1.2.3', '1.2.3') === 0)
check('1.0.0-rc.1 < 1.0.0 (prerelease sorts first)', compareVersions('1.0.0-rc.1', '1.0.0') === -1)
check('missing segments default to 0', compareVersions('1.2', '1.2.0') === 0)
check('build metadata is ignored', compareVersions('1.2.3+build.9', '1.2.3') === 0)

console.log('isPrerelease')
check('1.0.0 is stable', isPrerelease('1.0.0') === false)
check('1.0.0-beta.1 is a prerelease', isPrerelease('1.0.0-beta.1') === true)

console.log('classifySource')
const cases = [
  ['dshmarket@1.73.22', 'registry'],
  ['@linxin666/dsh-client-ui-task-board@0.4.19', 'registry'],
  ['cc-safety-net@^2.8.0', 'registry'],
  ['link:C:\\Users\\x\\y', 'local'],
  ['file:../../our-free-model/pinned-2.5.7', 'local'],
  ['github:AnakinCao/dsh-code-nav', 'git-unpinned'],
  ['git+ssh://git@github.com/a/b.git', 'git-unpinned'],
  ['https://github.com/a/b', 'git-unpinned'],
  ['github:AnakinCao/dsh-code-nav#0d34d27a391be14b289f687e0c96bae82891c82c', 'git'],
]
for (const [source, expected] of cases) {
  const got = classifySource(source)
  check(`${source} -> ${expected}`, got.channel === expected, got.channel)
}
check(
  'pinned git spec keeps the commit',
  classifySource('github:a/b#5619392300540e9e2dc59c5ed3ed87091d09225d').commit ===
    '5619392300540e9e2dc59c5ed3ed87091d09225d',
)
check('empty source is unknown', classifySource('').channel === 'unknown')

console.log('describeFailure')
// updateBundle resolves on a refusal, and its result.error is always an object.
// These cases cover every shape the panel has to turn into a sentence.
check(
  'a diagnostic is reported verbatim',
  describeFailure({
    error: { code: 'invalid-spec', diagnostic: '2.4.2 is not a version newer than the installed 2.4.2' },
  }) === '2.4.2 is not a version newer than the installed 2.4.2',
)
check(
  'a bare code still yields a readable reason',
  describeFailure({ error: { code: 'not-bundle' } }) === 'the new version does not declare a DSH bundle',
)
check(
  'an unknown bare code is not invented',
  describeFailure({ error: { code: 'something-new' } }) === '',
)
check(
  'incompatibility is rendered with the requirements and runtime',
  describeFailure({
    error: {
      code: 'incompatible-version',
      incompatible: [
        { name: 'dsh-context', version: '0.87.0', runtimeVersion: '0.2.1', requirements: { 'engines.dsh': '>=0.2.2' } },
      ],
    },
  }) === 'dsh-context@0.87.0 needs engines.dsh >=0.2.2 (running 0.2.1)',
)
check(
  'a failed install falls back to the manager output tail',
  describeFailure({
    error: { code: 'operation-error' },
    packageResult: { exitCode: 1, output: 'line one\nline two\nline three\nline four', truncated: false, logPath: 'x' },
  }) === 'line two line three line four',
)
check(
  'an unreachable git host is named as such',
  describeFailure({ error: { code: 'operation-error' }, failedAt: 'spec-host' }) ===
    'the Git host could not be reached',
)
check(
  'multiline diagnostics are cut down to their tail',
  describeFailure({ error: { code: 'operation-error', diagnostic: 'a\nb\nc\nd' } }) === 'b c d',
)
check('an empty result describes nothing', describeFailure({}) === '')

console.log('bulkQueue')
{
  const live = [
    { name: 'a', actionable: true, version: '2.0.0' },
    { name: 'b', actionable: false, kind: 'git' },
    { name: 'c', actionable: true, version: '3.0.0' },
    { name: 'd' },
    null,
    'junk',
  ]
  const queue = bulkQueue(live)
  check('keeps only actionable rows', queue.length === 2, `${queue.length}`)
  check('preserves the listed order', queue.map((entry) => entry.name).join() === 'a,c')
  check('skips entries that are not objects', queue.every((entry) => typeof entry.name === 'string'))
  check(
    'copies rows so a later sweep cannot retarget them',
    queue[0] !== live[0] && queue[0].version === '2.0.0' && live[0].version === '2.0.0',
  )
  live[0].version = '9.9.9'
  check('the snapshot keeps the version it was taken with', queue[0].version === '2.0.0')
  check('a missing list yields an empty queue', bulkQueue(undefined).length === 0)
}

console.log('resolveProfileDir')
const real = resolveProfileDir(process.env)
check('finds a profile on this machine', real.dir !== '', JSON.stringify(real))
check('the profile has a manifest', real.dir !== '' && readPinnedCommits(real.dir) instanceof Map)
const gitDeps = readGitDependencies(real.dir)
check('git dependencies are discovered from the manifest', gitDeps instanceof Map, `${gitDeps.size}`)
const commits = readPinnedCommits(real.dir)
check('lockfile pins are discovered', commits instanceof Map, `${commits.size}`)
for (const [name, pin] of commits) {
  check(`${name} pin is a full sha`, /^[0-9a-f]{40}$/.test(pin.commit), pin.commit)
}

console.log('')
if (failures === 0) {
  console.log('all host-half checks passed')
} else {
  console.log(`${failures} check(s) failed`)
  process.exitCode = 1
}
