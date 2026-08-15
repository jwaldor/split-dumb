// End-to-end smoke test for the MCP endpoint, driven by the real MCP client SDK
// (so it exercises the actual JSON-RPC/Streamable-HTTP path, not the internals).
//
//   npm run smoke            # against a server you already have running on :3001
//   MCP_URL=... npm run smoke # against anywhere else, e.g. the Railway deploy
//
// Creates a throwaway tab and deletes it at the end.

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const ENDPOINT = process.env.MCP_URL || 'http://localhost:3001/mcp'

let failures = 0
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ok   ${label}`)
  } else {
    failures++
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const client = new Client({ name: 'splitdumb-smoke', version: '1.0.0' })
await client.connect(new StreamableHTTPClientTransport(new URL(ENDPOINT)))
console.log(`connected to ${ENDPOINT}\n`)

async function call(name, args) {
  const r = await client.callTool({ name, arguments: args })
  const text = r.content?.[0]?.text ?? ''
  if (r.isError) return { __error: text }
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

// ---- tool surface ----------------------------------------------------------

const { tools } = await client.listTools()
const names = tools.map((t) => t.name)
console.log(`tools (${names.length}): ${names.join(', ')}\n`)
check('every tool has a description', tools.every((t) => t.description?.length > 20))
check(
  'no OCR / receipt-scanning tool is exposed',
  !names.some((n) => /scan|ocr|image|photo/i.test(n)),
  names.filter((n) => /scan|ocr|image|photo/i.test(n)).join(','),
)

// ---- create ----------------------------------------------------------------

console.log('\ncreate_tab')
const created = await call('create_tab', {
  creatorVenmo: '@smoke-host',
  merchant: 'Taco Bar',
  items: [
    { name: 'Carnitas taco', price: 4.5, quantity: 2 }, // 9.00
    { name: 'Burrito', price: 12 },
    { name: 'Horchata', price: 4 },
  ],
  tax: 2,
  tip: 4,
  extraCosts: 1.5,
})
const { tabId, creatorToken } = created
check('returns a tab id', !!tabId)
check('returns a creator token', creatorToken?.length === 24)
check('returns a share url', created.url?.endsWith(`/t/${tabId}`), created.url)
check('quantity is multiplied out (subtotal 25)', created.tab.subtotal === 25, created.tab.subtotal)
check('tax + tip + extraCosts land in the total (32.50)', created.tab.total === 32.5, created.tab.total)
check('extra costs are reported back', created.tab.extraCosts === 1.5)

console.log('\nget_share_link')
const share = await call('get_share_link', { tabId })
check('share link matches the tab url', share.url === created.url, share.url)
check('explains the QR join flow', /QR/i.test(share.howToJoin))

// ---- people and claims -----------------------------------------------------

console.log('\nadd_people / assign_items')
const people = await call('add_people', { tabId, names: ['Sam', 'Priya', 'Jo'] })
check('three people added', people.added.length === 3)

const items = created.tab.items
await call('assign_items', { tabId, person: 'Sam', itemIds: [items[0].id] })
await call('assign_items', { tabId, person: 'Priya', itemIds: [items[1].id], share: 0.5 })
await call('assign_items', { tabId, person: 'Jo', itemIds: [items[1].id], share: 0.5 })

const claimed = await call('get_tab', { tabId })
const owed = Object.fromEntries(claimed.people.map((p) => [p.name, p.owes]))
check('people are resolvable by name, not just id', claimed.people.length === 3)
check('Sam owes items 9 + proportional extras = 11.70', owed.Sam === 11.7, owed.Sam)
check('a halved item splits evenly (7.80 each)', owed.Priya === 7.8 && owed.Jo === 7.8)
check('unclaimed items are tracked (4.00 horchata)', claimed.unclaimedSubtotal === 4)

const over = await call('assign_items', { tabId, person: 'Sam', itemIds: [items[1].id], share: 1 })
check('claiming a fully-claimed item is refused', !!over.results[0].error, JSON.stringify(over.results))

// ---- host edits ------------------------------------------------------------

console.log('\nupdate_tab')
const upd = await call('update_tab', { tabId, creatorToken, tipPercent: 20, extraCosts: 3 })
check('tipPercent sets tip to 20% of pre-tax subtotal (5.00)', upd.tip === 5, upd.tip)
check('extra costs update independently', upd.extraCosts === 3)
check('total reflects both (25 + 2 + 5 + 3 = 35)', upd.total === 35, upd.total)

const renamed = await call('update_tab', { tabId, creatorToken, merchant: 'Taqueria', currency: 'usd' })
check('merchant is editable', renamed.merchant === 'Taqueria')
check('currency is normalized to upper case', renamed.currency === 'USD')

const bad = await call('update_tab', { tabId, creatorToken: 'wrong-token', tip: 999 })
check('a wrong creator token is rejected', !!bad.__error, bad.__error)
const noToken = await call('remove_item', { tabId, creatorToken: '', itemId: items[0].id })
check('host tools refuse an empty token', !!noToken.__error)

// ---- payment ---------------------------------------------------------------

console.log('\nget_payment_link')
const link = await call('get_payment_link', { tabId, person: 'Sam' })
check('builds a prefilled venmo link', link.venmoLink?.includes('recipients=smoke-host'), link.venmoLink)
check('amount in the link matches what they owe', link.venmoLink.includes(link.owes.toFixed(2)))

console.log('\nsplit_evenly')
const even = await call('split_evenly', { tabId })
const evenTotals = even.people.map((p) => p.owes)
check('everyone owes the same after an even split', new Set(evenTotals).size === 1, evenTotals.join(','))
check('nothing is left unclaimed', even.unclaimedSubtotal === 0)

console.log('\nmark_paid / confirm_payment')
await call('mark_paid', { tabId, person: 'Sam' })
const frozen = await call('add_items', { tabId, creatorToken, items: [{ name: 'Churro', price: 3 }] })
check('items freeze once someone marks themselves paid', !!frozen.__error, frozen.__error)
const confirmed = await call('confirm_payment', { tabId, creatorToken, person: 'Sam' })
check('host can confirm a payment landed', confirmed.people.find((p) => p.name === 'Sam').hostConfirmed)

// ---- cleanup ---------------------------------------------------------------

console.log('\ndelete_tab')
check('tab deletes', (await call('delete_tab', { tabId, creatorToken })).deleted === tabId)
check('deleted tab is gone', !!(await call('get_tab', { tabId })).__error)

await client.close()
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} CHECK(S) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
