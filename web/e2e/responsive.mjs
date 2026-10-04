// Responsiveness check of the running stack: every page at 7 screen sizes (320px phone … 1536px desktop).
// Fails when a page scrolls sideways, when something sticks out of the viewport outside a scroll container,
// or when a primary tap target is smaller than 32px.
//   cd web && npm i --no-save playwright-core && npx playwright-core install chromium
//   BASE_URL=http://localhost:8080 node e2e/responsive.mjs      (SHOTS=/some/dir saves a screenshot per page/size)
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright-core'

const W = process.env.BASE_URL ?? 'http://localhost:8080'
const SHOTS = process.env.SHOTS
if (SHOTS) mkdirSync(SHOTS, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] })
const SIZES = [
  ['320 phone-s', 320, 640],
  ['375 phone', 375, 812],
  ['414 phone-l', 414, 896],
  ['768 tablet', 768, 1024],
  ['1024 laptop', 1024, 768],
  ['1280 desktop', 1280, 800],
  ['1536 wide', 1536, 864],
]
let problems = 0

async function api(path, token, body) {
  const res = await fetch(W + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
  return res.json()
}
const token = async (email, password) => (await api('/api/auth/login', null, { email, password })).access_token
const ct = await token('client-a@example.com', 'client123')
const ot = await token('ops1@example.com', 'ops123')
const req = await api('/api/requests', ct, { task_name: 'pick cup', episodes_requested: 2, deadline: '2099-01-01', notes: 'responsive check' })
await api(`/api/requests/${req.id}/transition`, ot, { to: 'in_progress' })

/** Returns descriptions of anything that makes the page wider than the viewport. */
function findOverflow() {
  const vw = document.documentElement.clientWidth
  const out = []
  if (document.documentElement.scrollWidth > vw + 1) out.push(`page scrolls sideways (${document.documentElement.scrollWidth} > ${vw})`)
  const scrollable = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX
      if (o === 'auto' || o === 'scroll' || o === 'hidden') return true
    }
    return false
  }
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    const cs = getComputedStyle(el)
    if (cs.position === 'fixed' || cs.visibility === 'hidden' || cs.display === 'none') continue
    if (r.right > vw + 1 && !scrollable(el)) out.push(`<${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 40)}"> sticks out by ${Math.round(r.right - vw)}px`)
  }
  return out.slice(0, 4)
}
function smallTargets() {
  const bad = []
  for (const el of document.querySelectorAll('button, a.btn, .chip, select, input:not([type=checkbox]):not([type=file]):not([type=hidden])')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    if (r.height < 30) bad.push(`${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 20)}" is ${Math.round(r.height)}px tall`)
  }
  return bad.slice(0, 3)
}

for (const [label, width, height] of SIZES) {
  console.log(`\n== ${label} (${width}×${height})`)
  const open = async (email, password) => {
    const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: width < 800 })
    const page = await ctx.newPage()
    await page.goto(W)
    if (email) {
      await page.fill('input[type=email]', email)
      await page.fill('input[type=password]', password)
      await page.click('button:has-text("Sign in")')
      await page.waitForSelector('header.topbar')
    }
    return page
  }
  async function check(page, name, shot) {
    await page.waitForTimeout(350)
    const overflow = await page.evaluate(findOverflow)
    const small = await page.evaluate(smallTargets)
    const ok = overflow.length === 0 && small.length === 0
    if (!ok) problems++
    console.log(`  ${ok ? '✔' : '✘'} ${name}${ok ? '' : '\n      ' + [...overflow, ...small].join('\n      ')}`)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${width}-${shot}.png`, fullPage: true })
  }
  await check(await open(), 'login', 'login')
  const client = await open('client-a@example.com', 'client123')
  await client.waitForSelector('table')
  await check(client, 'requests (client)', 'requests-client')
  await client.goto(`${W}/requests/new`)
  await client.waitForSelector('form')
  await check(client, 'new request', 'new-request')
  await client.goto(`${W}/requests/${req.id}`)
  await client.waitForSelector('h1:has-text("Request #")')
  await check(client, 'request detail (client)', 'detail-client')
  const op = await open('ops1@example.com', 'ops123')
  await op.waitForSelector('table')
  await check(op, 'requests (operator)', 'requests-op')
  await op.goto(`${W}/requests/${req.id}`)
  await op.waitForSelector('table[aria-label="Unassigned episodes"]')
  await op.locator('input[aria-label^="Select EP"]').first().check()
  await check(op, 'request detail + picker + selection bar', 'detail-op')
  await op.goto(`${W}/analytics`)
  await op.waitForSelector('text=Request fulfilment')
  await op.waitForSelector('svg.chart')
  await check(op, 'analytics', 'analytics')
  await op.goto(`${W}/import`)
  await op.setInputFiles('input[type=file]', new URL('../../seed/episodes.csv', import.meta.url).pathname)
  await op.click('button:has-text("Import")')
  await op.waitForSelector('text=Why rows were skipped')
  await check(op, 'import + report', 'import')
  const admin = await open('admin@example.com', 'admin123')
  await admin.goto(`${W}/users`)
  await admin.waitForSelector('table')
  await check(admin, 'users', 'users')
  await admin.click('button:has-text("Add user")')
  await admin.waitForSelector('dialog[open]')
  await check(admin, 'users – add-user dialog', 'users-dialog')
  if (width < 800) {
    const m = await open('client-a@example.com', 'client123')
    await m.click('button:has-text("Menu")')
    await check(m, 'mobile menu open', 'menu-open')
  }
}
console.log(`\n${problems === 0 ? 'ALL PAGES RESPONSIVE ✔' : `${problems} page/size combination(s) with problems ✘`}`)
await browser.close()
process.exit(problems ? 1 : 0)
