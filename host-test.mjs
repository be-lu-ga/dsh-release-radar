/**
 * Headless self-test for the Host half's pure logic.
 *
 * The Host half only exports pure helpers plus `apply`, so importing it here
 * costs nothing: no Cordis context is touched until apply() runs.
 *
 * Run: node host-test.mjs
 */
import {
  classifySource,
  compareVersions,
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
