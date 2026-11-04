import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const causes = JSON.parse(readFileSync(new URL('./causes.json', import.meta.url), 'utf8'))
const DAY = 864e5
const HEAVY = ['node_modules', '.venv', 'venv', 'target', '.next']

function git(dir, ...args) {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (r.error) throw r.error
  if (r.status !== 0) {
    throw Object.assign(new Error(r.stderr.trim().split('\n')[0] || `git ${args[0]} failed`), { git: true })
  }
  return r.stdout.trim()
}

const count = out => (out ? out.split('\n').length : 0)

export const plural = (n, word, many = word + 's') => `${n} ${n === 1 ? word : many}`

// Repos in root and one level down, so dev/courses/some-repo counts too.
export function findRepos(root, depth = 2) {
  const repos = []
  const plain = []
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return { repos, plain }
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue
    const dir = join(root, e.name)
    if (existsSync(join(dir, '.git'))) {
      repos.push(dir)
      continue
    }
    const inner = depth > 1 ? findRepos(dir, depth - 1).repos : []
    if (inner.length) repos.push(...inner)
    else plain.push(dir)
  }
  return { repos, plain }
}

export function inspect(dir) {
  const commits = Number(git(dir, 'rev-list', '--count', '--branches', '--remotes'))
  const r = {
    dir,
    commits,
    remote: git(dir, 'remote') !== '',
    dirty: count(git(dir, 'status', '--porcelain')),
    stashes: commits ? count(git(dir, 'stash', 'list')) : 0,
    unpushed: commits ? Number(git(dir, 'rev-list', '--count', '--branches', '--not', '--remotes')) : 0,
    last: null,
  }
  if (commits) {
    const fmt = '--format=%ct%x1f%ci%x1f%an%x1f%s%x1f%b'
    const [ct, ci, author, subject, body] = git(dir, 'log', '-1', '--branches', '--remotes', fmt).split('\x1f')
    r.last = { date: ct * 1000, hour: Number(ci.slice(11, 13)), author, subject, body }
  }
  return r
}

export const isDead = (r, days, now = Date.now()) => !r.commits || now - r.last.date > days * DAY

export function heavy(dir) {
  const names = HEAVY.filter(name => existsSync(join(dir, name)))
  return { names, bytes: names.reduce((sum, name) => sum + size(join(dir, name)), 0) }
}

function size(path) {
  try {
    const s = lstatSync(path)
    if (!s.isDirectory()) return s.size
    return readdirSync(path).reduce((sum, name) => sum + size(join(path, name)), 0)
  } catch {
    return 0
  }
}

export function risks(r) {
  const out = []
  if (!r.remote && r.commits) {
    out.push(r.commits === 1 ? 'no remote, its only commit lives on this disk' : `no remote, all ${r.commits} commits live only on this disk`)
  }
  if (r.remote && r.unpushed) out.push(plural(r.unpushed, 'unpushed commit'))
  if (r.dirty) out.push(plural(r.dirty, 'uncommitted change'))
  if (r.stashes) out.push(plural(r.stashes, 'stash', 'stashes'))
  return out
}

// [bot] authors, aider's "(aider)" suffix, and agents that sign with a noreply co-author trailer
const isBot = ({ author, body }) =>
  /\[bot\]|\(aider\)/i.test(author) || /^co-authored-by:.*<(noreply|cursoragent)@/im.test(body)

export function causeOfDeath(r, now = Date.now()) {
  // same repo, same verdict: pick by name instead of Math.random
  const hash = [...r.name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7)
  const pick = list => list[hash % list.length]
  if (!r.commits) return pick(causes.stillborn)
  if (r.commits === 1) return pick(causes.oneCommit)
  if (isBot(r.last)) return pick(causes.robot)
  const hit = causes.messages.find(m => new RegExp(m.match, 'i').test(r.last.subject))
  if (hit) return pick(hit.causes).replace('{msg}', r.last.subject)
  if (r.dirty) return pick(causes.dirty)
  if (r.last.hour < 6) return pick(causes.night)
  if (now - r.last.date > 3 * 365 * DAY) return pick(causes.ancient)
  return pick(causes.fallback)
}
