#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import { causeOfDeath, findRepos, heavy, inspect, isDead, plural, risks } from './graveyard.js'

const HELP = `Usage: repo-graveyard [folder] [--days N]

Finds the git repos in a folder (and one level down), tells you which
ones are dead, how they died, and what you'd lose if your disk died too.

  --days N    no commits in N days means dead (default: 90)
  -h, --help  show this`

const fail = msg => {
  console.error(`repo-graveyard: ${msg}`)
  process.exit(1)
}

let root = '.'
let days = 90
const args = process.argv.slice(2)
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '-h' || a === '--help') {
    console.log(HELP)
    process.exit(0)
  } else if (a === '--days') {
    days = Number(args[++i])
    if (!Number.isInteger(days) || days < 1) fail('--days needs a whole number of days, like --days 30')
  } else if (a.startsWith('-')) {
    fail(`unknown option ${a}. Try --help`)
  } else {
    root = a
  }
}

root = resolve(root)
if (!existsSync(root) || !statSync(root).isDirectory()) fail(`${root} is not a folder`)
if (spawnSync('git', ['--version']).error) fail("git not found. The dead don't talk without it.")

const tty = process.stdout.isTTY && !process.env.NO_COLOR
const paint = code => s => (tty ? `\x1b[${code}m${s}\x1b[0m` : s)
const dim = paint(2)
const yellow = paint(33)
const name = dir => relative(root, dir) || basename(dir)
const size = b => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`)

function ago(ms) {
  const d = ms / 864e5
  const [n, unit] = d >= 365 ? [Math.floor(d / 365), 'year'] : d >= 60 ? [Math.floor(d / 30), 'month'] : [Math.floor(d), 'day']
  return `${plural(n, unit)} ago`
}

const { repos, plain } = existsSync(join(root, '.git')) ? { repos: [root], plain: [] } : findRepos(root)
if (!repos.length) {
  console.log('No git repos here. Either you are very organized or in the wrong folder.')
  process.exit(0)
}

const now = Date.now()
const dead = []
const unreadable = []
for (const dir of repos) {
  try {
    const r = inspect(dir)
    r.name = name(dir)
    if (isDead(r, days, now)) dead.push(r)
  } catch (e) {
    if (!e.git) throw e
    unreadable.push(`${name(dir)}: ${e.message}`)
  }
}

dead.sort((a, b) => (a.last?.date ?? 0) - (b.last?.date ?? 0))
const width = Math.max(...dead.map(r => r.name.length))
let atRisk = 0
let rotting = 0
for (const r of dead) {
  const when = r.last ? `† ${ago(now - r.last.date)}` : '† before its first commit'
  console.log(`🪦 ${r.name.padEnd(width)}  ${dim(when)}`)
  console.log(`   cause of death: ${causeOfDeath(r, now)}`)
  const lose = risks(r)
  if (lose.length) {
    atRisk++
    console.log(yellow(`   ⚠ ${lose.join(', ')}`))
  }
  const h = heavy(r.dir)
  if (h.bytes) {
    rotting += h.bytes
    console.log(dim(`   ${size(h.bytes)} in ${h.names.join(', ')}`))
  }
}

const summary = [plural(repos.length, 'repo'), `${dead.length} dead`, `${repos.length - dead.length - unreadable.length} alive`]
if (atRisk) summary.push(`${atRisk} with work you'd lose`)
if (rotting) summary.push(`${size(rotting)} of dependencies rotting`)
console.log(`${dead.length ? '\n' : ''}${summary.join(' · ')}`)
if (!dead.length) console.log('Nobody died. Suspicious.')

if (plain.length) {
  const names = plain.map(name)
  const shown = names.length > 5 ? `${names.slice(0, 5).join(', ')} and ${names.length - 5} more` : names.join(', ')
  console.log(dim(`${plural(plain.length, 'folder')} with no git at all (no history, no backup, no funeral): ${shown}`))
}
if (unreadable.length) console.log(yellow(`couldn't read ${plural(unreadable.length, 'repo')}:\n  ${unreadable.join('\n  ')}`))
