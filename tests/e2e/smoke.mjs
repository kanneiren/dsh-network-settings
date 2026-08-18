import { chromium } from 'playwright-core'
import { writeFileSync } from 'node:fs'

const url = process.env.DSH_URL ?? 'http://127.0.0.1:3091'
const executablePath = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const browser = await chromium.launch({ executablePath, headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const logs = []
page.on('console', msg => { logs.push(`${msg.type()}: ${msg.text()}`) })
page.on('pageerror', err => logs.push(`pageerror: ${err.message}`))

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
await page.waitForTimeout(1500)

async function clickText(name, fallback) {
  const locator = page.getByText(name, { exact: true }).first()
  const fallbackLocator = fallback === undefined ? null : page.getByText(fallback, { exact: true }).first()
  const target = await locator.count() > 0 ? locator : fallbackLocator
  if (target === null || await target.count() === 0) throw new Error(`text not found: ${name}`)
  await target.click()
  await page.waitForTimeout(400)
}

await clickText('设置', 'Settings')
await clickText('插件', 'Plugins')
await clickText('网络', 'Network')

await page.waitForTimeout(1000)
const before = await page.locator('body').innerText()
console.log('network tab visible:', before.includes('一键全面检测') || before.includes('Run full network check'))
await page.screenshot({ path: '.research/network-settings-before.png', fullPage: true })

const runButton = page.getByText('单次检测', { exact: true }).first()
const runButtonEn = page.getByText('Single check', { exact: true }).first()
if (await runButton.count() > 0) await runButton.click()
else if (await runButtonEn.count() > 0) await runButtonEn.click()
else throw new Error('run button not found')

await page.waitForFunction(
  () => document.body.innerText.includes('检测中') || document.body.innerText.includes('Checking'),
  { timeout: 5_000 },
).catch(() => {})
const running = await page.locator('body').innerText()
console.log('loading state visible:', running.includes('检测中') || running.includes('Checking'))
await page.waitForFunction(
  () => !document.body.innerText.includes('检测中') && !document.body.innerText.includes('Checking'),
  { timeout: 90_000 },
)
await page.waitForTimeout(500)
const details = page.getByText('诊断结果', { exact: true }).first()
if (await details.count() > 0) {
  await details.click()
  await page.waitForTimeout(400)
}
const after = await page.locator('body').innerText()
console.log('--- body excerpt ---')
console.log(after.slice(0, 1800))
await page.screenshot({ path: '.research/network-settings-after.png', fullPage: true })
writeFileSync('.research/e2e-logs.txt', logs.join('\n'))
await browser.close()
