// Accessibility audit of the running stack with axe-core (WCAG 2.1 A/AA + best practices).
//   cd web && npm i --no-save playwright-core axe-core && npx playwright-core install chromium
//   BASE_URL=http://localhost:8080 node e2e/a11y.mjs     (set CHROME_PATH to use an existing Chrome/Chromium)
// Creates one throw-away request (as client A, moved to "in progress" by an operator) so the operator pages can be audited.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { chromium } from 'playwright-core'

const axeSrc = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')
const W = process.env.BASE_URL ?? 'http://localhost:8080'
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] })
let total = 0

async function api(path, token, body) {
  const res = await fetch(W + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
  return res.json()
}
const token = async (email, password) => (await api('/api/auth/login', null, { email, password })).access_token
const clientToken = await token('client-a@example.com', 'client123')
const opToken = await token('ops1@example.com', 'ops123')
const mine = await api('/api/requests', clientToken, { task_name: 'pick cup', episodes_requested: 2, deadline: '2099-01-01', notes: 'a11y audit' })
await api(`/api/requests/${mine.id}/transition`, opToken, { to: 'in_progress' })

async function audit(page, name) {
  await page.evaluate(axeSrc)
  const result = await page.evaluate(() =>
    axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } }),
  )
  total += result.violations.length
  console.log(`${result.violations.length ? '✘' : '✔'} ${name}: ${result.violations.length} violation(s)`)
  for (const v of result.violations) console.log(`    [${v.impact}] ${v.id}: ${v.help} — ${v.nodes[0]?.target.join(' ')}`)
}

for (const scheme of ['light']) {
  console.log(`\n== ${scheme} theme`)
  const open = async (email, password) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: scheme, bypassCSP: true })
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
  await audit(await open(), 'login')
  const client = await open('client-a@example.com', 'client123')
  await client.waitForSelector('table')
  await audit(client, 'requests (client)')
  await client.goto(`${W}/requests/new`)
  await client.waitForSelector('form')
  await audit(client, 'new request')
  await client.goto(`${W}/requests/${mine.id}`)
  await client.waitForSelector('h1:has-text("Request #")')
  await audit(client, 'request detail (client)')
  const op = await open('ops1@example.com', 'ops123')
  await op.goto(`${W}/requests/${mine.id}`)
  await op.waitForSelector('table[aria-label="Unassigned episodes"]')
  await audit(op, 'request detail + episode picker (operator)')
  await op.goto(`${W}/analytics`)
  await op.waitForSelector('text=Request fulfilment')
  await audit(op, 'analytics')
  await op.goto(`${W}/import`)
  await op.waitForSelector('text=Drop a CSV file here')
  await audit(op, 'import')
  const admin = await open('admin@example.com', 'admin123')
  await admin.goto(`${W}/users`)
  await admin.waitForSelector('table')
  await audit(admin, 'users')
  await admin.click('button:has-text("Add user")')
  await admin.waitForSelector('dialog[open]')
  await audit(admin, 'users – add-user dialog')
}
console.log(`\nTOTAL violations: ${total}`)
await browser.close()
process.exit(total ? 1 : 0)
