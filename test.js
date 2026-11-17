import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { causeOfDeath } from './graveyard.js'

const causes = JSON.parse(readFileSync(new URL('./causes.json', import.meta.url), 'utf8'))
const cli = fileURLToPath(new URL('./cli.js', import.meta.url))
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } })
const old = '2020-01-15T15:00:00Z'

function repo(dir) {
  mkdirSync(dir, { recursive: true })
  const git = (args, date) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      cwd: dir,
      stdio: 'pipe',
      env: { ...process.env, ...(date && { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }) },
    })
  git(['init', '-q'])
  const commit = (msg, date) => {
    writeFileSync(join(dir, 'file.txt'), msg)
    git(['add', '.'])
    git(['commit', '-qm', msg], date)
  }
  return { git, commit }
}

test('finds the dead and what you would lose', () => {
  const root = mkdtempSync(join(tmpdir(), 'graveyard-'))
  const zombie = repo(join(root, 'zombie'))
  zombie.commit('init', old)
  zombie.commit('wip', old)
  writeFileSync(join(root, 'zombie', 'notes.txt'), 'finish this')
  mkdirSync(join(root, 'zombie', 'node_modules', 'left-pad'), { recursive: true })
  writeFileSync(join(root, 'zombie', 'node_modules', 'left-pad', 'index.js'), 'x'.repeat(2e6))
  const fresh = repo(join(root, 'fresh'))
  fresh.commit('init')
  fresh.commit('works on my machine')
  repo(join(root, 'empty'))
  const nested = repo(join(root, 'courses', 'final-project'))
  nested.commit('init', old)
  nested.commit('readme', old)
  mkdirSync(join(root, 'not-a-repo'))

  const { stdout, status } = run(root)
  assert.equal(status, 0)
  assert.match(stdout, /zombie/)
  assert.match(stdout, /no remote, all 2 commits live only on this disk/)
  assert.match(stdout, /uncommitted change/)
  assert.match(stdout, /2 MB in node_modules/)
  assert.match(stdout, /empty\s+† before its first commit/)
  assert.match(stdout, /final-project/)
  assert.doesNotMatch(stdout, /🪦 fresh/)
  assert.match(stdout, /4 repos · 3 dead · 1 alive · 2 with work you'd lose/)
  assert.match(stdout, /1 folder with no git at all/)
})

test('counts unpushed commits', () => {
  const root = mkdtempSync(join(tmpdir(), 'graveyard-'))
  execFileSync('git', ['init', '-q', '--bare', join(root, 'remote.git')])
  const app = repo(join(root, 'projects', 'app'))
  app.commit('init', old)
  app.git(['remote', 'add', 'origin', join(root, 'remote.git')])
  app.git(['push', '-q', 'origin', 'HEAD'])
  app.commit('one more thing', old)

  const { stdout } = run(join(root, 'projects'))
  assert.match(stdout, /⚠ 1 unpushed commit\b/)
  assert.doesNotMatch(stdout, /no remote/)
})

test('blames the robot when a bot made the last commit', () => {
  const r = { name: 'x', commits: 9, dirty: 0, last: { date: 0, hour: 12, author: 'me', subject: 'wip', body: 'Co-authored-by: Some Agent <noreply@example.com>' } }
  assert.ok(causes.robot.includes(causeOfDeath(r)))
})

test('quotes lazy commit messages', () => {
  const r = { name: 'x', commits: 9, dirty: 0, last: { date: 0, hour: 12, author: 'me', subject: 'asdf', body: '' } }
  assert.equal(causeOfDeath(r), 'last words: "asdf"')
})

test('rejects bad input', () => {
  assert.equal(run('--days', 'soon').status, 1)
  assert.equal(run('--nope').status, 1)
  assert.equal(run(join(tmpdir(), 'does-not-exist-123')).status, 1)
})
