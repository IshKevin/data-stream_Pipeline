// Browser smoke test of the whole stack (needs the stack running).
//   cd web && npm i --no-save playwright-core && npx playwright-core install chromium
//   BASE_URL=http://localhost:8080 node e2e/smoke.mjs   (set CHROME_PATH to use an existing Chrome/Chromium)
// Creates a request as a client and drives it through reject -> rework -> accept as an operator.
import { chromium } from 'playwright-core'
const exe = process.env.CHROME_PATH // optional; defaults to Playwright's own browser
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] })
const W = process.env.BASE_URL ?? 'http://localhost:8080'
const errors = []
const log = (m) => console.log('✔', m)

async function login(email, password) {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${email}: ${e.message}`))
  page.on('console', (m) => m.type() === 'error' && errors.push(`${email} console: ${m.text()}`))
  await page.goto(W)
  await page.fill('input[type=email]', email)
  await page.fill('input[type=password]', password)
  await page.click('button:has-text("Sign in")')
  await page.waitForSelector('text=Log out')
  return page
}

const client = await login('client-a@example.com', 'client123')
log('client logged in; nav shows: ' + (await client.locator('nav a').allInnerTexts()).join(', '))
const ops = await login('ops1@example.com', 'ops123')
log('operator logged in; nav shows: ' + (await ops.locator('nav a').allInnerTexts()).join(', '))
await ops.waitForSelector('.live-on')
log('operator live indicator is on')

// client creates a request
await client.click('text=New request')
await client.fill('input[placeholder="e.g. pick cup"]', 'Pick Cup')
await client.fill('input[type=number]', '2')
await client.fill('input[type=date]', '2027-03-01')
await client.fill('textarea', 'UI test request')
await client.click('button:has-text("Submit request")')
await client.waitForSelector('h2:has-text("Request #")')
const title = await client.locator('h2:has-text("Request #")').innerText()
const id = title.match(/#(\d+)/)[1]
log(`client created ${title.trim()}`)

// operator sees it live (no refresh)
await ops.waitForSelector(`a:has-text("#${id}")`, { timeout: 8000 })
log('operator saw the new request appear live (SSE), without reloading')

await ops.click(`a:has-text("#${id}")`)
await ops.waitForSelector('button:has-text("Start work")')
const deliverBefore = await ops.locator('button:has-text("Mark delivered")').count()
await ops.click('button:has-text("Start work")')
await ops.waitForSelector('button:has-text("Mark delivered")')
log('operator started work; deliver button disabled until assigned: ' + (await ops.locator('button:has-text("Mark delivered")').isDisabled()))
await client.waitForSelector('text=In progress', { timeout: 8000 })
log('client page updated live to "In progress"')

// assign 2 episodes via the picker (default filter = request task)
await ops.waitForSelector('input[aria-label^="Select EP"]')
await ops.locator('select').nth(1).selectOption('good') // quality filter
await ops.waitForTimeout(800)
const boxes = ops.locator('input[aria-label^="Select EP"]')
await boxes.nth(0).check()
await boxes.nth(1).check()
await ops.click('button:has-text("Assign selected (2)")')
await ops.waitForSelector('text=Enough episodes assigned')
log('operator assigned 2 episodes')
await ops.click('button:has-text("Mark delivered")')
await client.waitForSelector('button:has-text("Accept delivery")', { timeout: 8000 })
log('client sees Accept/Reject after delivery (live)')

await client.click('button:has-text("Reject delivery")')
await client.fill('textarea', 'blurry footage')
await client.click('button:has-text("Confirm rejection")')
await client.waitForSelector('.badge-rejected')
log('client rejected with a reason')
await ops.waitForSelector('button:has-text("Start work")', { timeout: 8000 }) // rework = rejected -> in_progress
await ops.click('button:has-text("Start work")')
await ops.waitForSelector('button:has-text("Mark delivered"):not([disabled])')
await ops.click('button:has-text("Mark delivered")')
await client.waitForSelector('button:has-text("Accept delivery")', { timeout: 8000 })
await client.click('button:has-text("Accept delivery")')
await client.waitForSelector('.badge-accepted')
log('rework cycle completed; client accepted')
const hist = await client.locator('.timeline li').allInnerTexts()
log('history: ' + hist.map((h) => h.split('\n')[0]).reverse().join(' | '))

// operator pages
await ops.click('nav a:has-text("Analytics")')
await ops.waitForSelector('text=Median time from submitted to delivered')
log('analytics page renders')
await ops.click('nav a:has-text("Import")')
await ops.setInputFiles('input[type=file]', new URL('../../seed/episodes.csv', import.meta.url).pathname)
await ops.click('button:has-text("Import")')
await ops.waitForSelector('text=Why rows were skipped')
log('import report: ' + (await ops.locator('.stats').innerText()).replace(/\n/g, ' '))

// client must not reach staff pages
await client.goto(W + '/analytics')
await client.waitForURL('**/requests')
log('client redirected away from /analytics')

// other client cannot open this request
const other = await login('client-b@example.com', 'client123')
await other.goto(`${W}/requests/${id}`)
await other.waitForSelector('text=Request not found')
log("other client gets 'Request not found' for someone else's request")

// admin users page
const admin = await login('admin@example.com', 'admin123')
await admin.click('nav a:has-text("Users")')
await admin.waitForSelector('text=Add a user')
log('admin users page renders')


console.log(errors.length ? 'BROWSER ERRORS:\n' + errors.join('\n') : 'no browser console/page errors')
await browser.close()
