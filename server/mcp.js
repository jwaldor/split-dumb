// MCP backend for SplitDumb.
//
// Exposes the whole app as tools over Streamable HTTP at /mcp, so an MCP client
// (Claude, ChatGPT, anything else) can build and run a tab end to end without
// touching the web UI.
//
// Deliberately NOT exposed: receipt OCR. The client is a vision model already —
// it should read the photo itself and send structured line items to `add_items`.
// That keeps the paid OpenRouter key unreachable from connectors and gives the
// model a chance to sanity-check the numbers before they hit the tab.
//
// Auth model is unchanged from the web app: reading a tab is public (anyone
// with the link can see it), and every edit that belongs to the host requires
// the tab's `creatorToken`, which is handed out exactly once by `create_tab`.
//
// Transport is stateless — a fresh Server + transport per request, no session
// ids. That's the most compatible mode for hosted connectors and survives
// Railway restarts without stranding sessions.

import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import * as core from './core.js'
import { venmoPayLink } from '../shared/venmo.js'

const SERVER_INFO = { name: 'splitdumb', version: '1.0.0' }

const INSTRUCTIONS = `SplitDumb splits a bill without anyone making an account.

Typical flow:
1. create_tab with the host's Venmo handle and the line items you already read
   off the receipt. You get back a tabId, a shareable url, and a creatorToken.
2. Give the user the url. That page shows a QR code the rest of the table scans
   to join and claim their own items — it is how anyone else gets on the tab, so
   always hand it over, don't just describe it. (get_share_link re-fetches it.)
3. add_people, then assign_items or split_evenly, if you're doing the claiming
   for them instead.
4. get_tab to show who owes what, and get_payment_link for a person's Venmo link.

IMPORTANT: there is no receipt-scanning tool here on purpose. If the user gives
you a receipt photo, read it yourself and pass the line items to create_tab or
add_items. Show the user the items and totals you extracted before you write
them to a tab.

The creatorToken is a secret that authorizes host actions (editing items,
changing tax/tip/extra costs, confirming payments, deleting the tab). Keep it in
the conversation and pass it on every host call. Anyone with just the tabId can
read the tab and claim items, which is the point — that's the shared link.

CRITICAL — SplitDumb cannot tell whether anyone actually paid. There is no
Venmo integration; nothing here ever observes a real transaction. Both payment
flags are just button presses: saysPaid means the payer tapped "mark as paid"
(possibly premature, mistaken or untrue), and hostConfirmed means the host
ticked "got it", presumably after checking their own Venmo — a human's word,
not a verified receipt. Never state that money moved. Say "Sam has marked
themselves paid", not "Sam paid you"; say "you've confirmed $48 of $71", not
"$48 has been collected". If the user needs certainty, tell them to check Venmo.

If you can schedule recurring work, offer once — after the tab is set up — to
keep an eye on it, and keep the menu short: (a) a daily update on who has marked
themselves paid and who hasn't, (b) quiet unless it stalls, nudging if nobody
new has marked themselves paid for a couple of days, or (c) a single ping when
everyone has marked themselves paid. Say up front that you can only see what
people tick in the app. Default to (a) if they just say yes. Put the tabId in
the scheduled task's own instructions (it starts with no memory of this
conversation), keep it read-only — get_tab needs no token, so never put the
creatorToken in a scheduled job — and stop, saying so, once the tab is settled.
Word scheduled updates especially carefully: the user reads them later without
you there to qualify anything. If you cannot schedule anything, say the user can
ask any time instead of promising to check back.`

// ---- tool helpers ----------------------------------------------------------

const ok = (payload) => ({
  content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
})

const fail = (message) => ({
  isError: true,
  content: [{ type: 'text', text: message }],
})

// Wrap a handler so ApiError comes back as a readable tool error rather than a
// transport-level exception the model can't act on.
const handler = (fn) => async (args) => {
  try {
    return await fn(args)
  } catch (err) {
    if (err instanceof core.ApiError) return fail(err.message)
    console.error('[mcp]', err)
    return fail(err?.message || 'Unexpected server error.')
  }
}

// Load a tab and check the creator token in one step — every host tool starts
// this way.
function asCreator(tabId, creatorToken) {
  return core.requireCreator(core.requireTab(tabId), creatorToken)
}

const itemShape = z.object({
  name: z.string().describe('What it is, as written on the receipt (e.g. "Carnitas taco").'),
  price: z
    .number()
    .describe('Line total in the tab currency — already multiplied out if the line had a quantity.'),
  quantity: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Only set this if `price` is the UNIT price; it will be multiplied out.'),
})

const tabId = z.string().describe('The tab id, e.g. "aK4mZ2xQ".')
const creatorToken = z.string().describe('The host secret returned by create_tab.')

// ---- server ----------------------------------------------------------------

export function buildMcpServer({ baseUrl }) {
  const server = new McpServer(SERVER_INFO, {
    instructions: INSTRUCTIONS,
    capabilities: { tools: {} },
  })

  const summary = (id) => core.summarize(id, { baseUrl })

  // -- create / read ---------------------------------------------------------

  server.registerTool(
    'create_tab',
    {
      title: 'Create a tab',
      description:
        'Start a new SplitDumb tab. You can seed it with line items in the same call — if the ' +
        'user gave you a receipt photo, read the items off it yourself and pass them here. ' +
        'Returns the tab id, the shareable url to send people, and the creatorToken (a secret ' +
        'the host needs for every later edit — surface it to the user and keep it for this ' +
        'conversation).',
      inputSchema: {
        creatorVenmo: z
          .string()
          .describe('The host\'s Venmo handle — who everyone pays. With or without the leading @.'),
        merchant: z.string().optional().describe('Restaurant or store name, shown as the tab title.'),
        currency: z.string().optional().describe('ISO code, defaults to USD.'),
        items: z.array(itemShape).optional().describe('Line items to seed the tab with.'),
        tax: z.number().optional().describe('Tax amount from the receipt.'),
        tip: z.number().optional().describe('Tip amount.'),
        extraCosts: z
          .number()
          .optional()
          .describe('Anything else on top: credit-card surcharge, service charge, delivery fee.'),
      },
      annotations: { title: 'Create a tab', readOnlyHint: false, destructiveHint: false },
    },
    handler(async ({ items, extraCosts, ...rest }) => {
      const { id, creatorToken: token } = core.createTab({ ...rest, fees: extraCosts })
      if (items?.length) core.addItems(core.requireTab(id), items)
      return ok({
        tabId: id,
        url: `${baseUrl}/t/${id}`,
        creatorToken: token,
        creatorTokenNote:
          'Secret. Required for every host action on this tab. Show it to the user so they can ' +
          'keep it, and pass it back on later calls.',
        tab: summary(id),
      })
    }),
  )

  server.registerTool(
    'get_tab',
    {
      title: 'Get a tab',
      description:
        'Read the full current state of a tab: items, who claimed what, and exactly what each ' +
        'person owes including their share of tax, tip and extra costs. No token needed. ' +
        'Note `saysPaid` and `hostConfirmed` are self-reported button presses, not verified ' +
        'payments — see `paymentStatusCaveat` in the response.',
      inputSchema: { tabId },
      annotations: { title: 'Get a tab', readOnlyHint: true },
    },
    handler(async ({ tabId: id }) => ok(summary(id))),
  )

  server.registerTool(
    'get_share_link',
    {
      title: 'Get the link to share',
      description:
        'Get the tab\'s URL — the one thing everyone else needs. Opening it shows a QR code that ' +
        'other people scan to join the tab, enter their name and claim their items. Always give ' +
        'this link to the user after creating a tab: they open it and let the table scan the QR ' +
        '(or forward the link directly). No token needed.',
      inputSchema: { tabId },
      annotations: { title: 'Get the share link', readOnlyHint: true },
    },
    handler(async ({ tabId: id }) => {
      const tab = core.requireTab(id)
      return ok({
        tabId: tab.id,
        url: `${baseUrl}/t/${tab.id}`,
        howToJoin:
          'Open this link to show a QR code others can scan. Anyone who scans it (or opens the ' +
          'link) types their name and claims their items — no account needed.',
        payTo: `@${tab.creator_venmo}`,
      })
    }),
  )

  server.registerTool(
    'update_tab',
    {
      title: 'Update a tab',
      description:
        'Change anything about the tab itself: merchant name, currency, the host\'s Venmo handle, ' +
        'tax, tip, or extra costs (card fees, service charge, delivery). Omitted fields are left ' +
        'alone. Use tipPercent to set the tip as a percentage of the pre-tax subtotal.',
      inputSchema: {
        tabId,
        creatorToken,
        merchant: z.string().optional(),
        currency: z.string().optional(),
        creatorVenmo: z.string().optional().describe('Change who gets paid.'),
        tax: z.number().optional(),
        tip: z.number().optional(),
        tipPercent: z
          .number()
          .optional()
          .describe('Set the tip to this % of the pre-tax subtotal. Overrides `tip` if both are given.'),
        extraCosts: z
          .number()
          .optional()
          .describe('Extra costs on top of tax and tip — card surcharge, service charge, delivery.'),
      },
      annotations: { title: 'Update a tab', readOnlyHint: false, destructiveHint: false },
    },
    handler(async ({ tabId: id, creatorToken: token, tipPercent, extraCosts, ...patch }) => {
      const tab = asCreator(id, token)
      if (tipPercent != null) patch.tip = core.tipFromPercent(tab, tipPercent)
      if (extraCosts != null) patch.fees = extraCosts
      core.updateTab(tab, patch)
      return ok(summary(id))
    }),
  )

  server.registerTool(
    'delete_tab',
    {
      title: 'Delete a tab',
      description: 'Permanently delete a tab and everything on it. Cannot be undone.',
      inputSchema: { tabId, creatorToken },
      annotations: { title: 'Delete a tab', readOnlyHint: false, destructiveHint: true },
    },
    handler(async ({ tabId: id, creatorToken: token }) => ok(core.deleteTab(asCreator(id, token)))),
  )

  // -- items -----------------------------------------------------------------

  server.registerTool(
    'add_items',
    {
      title: 'Add items',
      description:
        'Append line items to a tab. If the user handed you a receipt photo, read it yourself ' +
        'and send the items here — there is no scanning tool. Items are frozen once anyone has ' +
        'marked themselves paid.',
      inputSchema: { tabId, creatorToken, items: z.array(itemShape).min(1) },
      annotations: { title: 'Add items', readOnlyHint: false, destructiveHint: false },
    },
    handler(async ({ tabId: id, creatorToken: token, items }) => {
      const added = core.addItems(asCreator(id, token), items)
      return ok({ added, tab: summary(id) })
    }),
  )

  server.registerTool(
    'update_item',
    {
      title: 'Update an item',
      description: 'Fix an item\'s name and/or price. Omitted fields are left alone.',
      inputSchema: {
        tabId,
        creatorToken,
        itemId: z.string().describe('Item id from get_tab.'),
        name: z.string().optional(),
        price: z.number().optional(),
      },
      annotations: { title: 'Update an item', readOnlyHint: false, destructiveHint: false },
    },
    handler(async ({ tabId: id, creatorToken: token, itemId, name, price }) => {
      core.updateItem(asCreator(id, token), itemId, { name, price })
      return ok(summary(id))
    }),
  )

  server.registerTool(
    'remove_item',
    {
      title: 'Remove an item',
      description: 'Delete one item and any claims on it.',
      inputSchema: { tabId, creatorToken, itemId: z.string() },
      annotations: { title: 'Remove an item', readOnlyHint: false, destructiveHint: true },
    },
    handler(async ({ tabId: id, creatorToken: token, itemId }) => {
      core.removeItem(asCreator(id, token), itemId)
      return ok(summary(id))
    }),
  )

  server.registerTool(
    'clear_items',
    {
      title: 'Clear all items',
      description:
        'Delete every item on the tab (and every claim) so the receipt can be re-entered from ' +
        'scratch. People, tax, tip and extra costs are kept.',
      inputSchema: { tabId, creatorToken },
      annotations: { title: 'Clear all items', readOnlyHint: false, destructiveHint: true },
    },
    handler(async ({ tabId: id, creatorToken: token }) => {
      core.clearItems(asCreator(id, token))
      return ok(summary(id))
    }),
  )

  // -- people ----------------------------------------------------------------

  server.registerTool(
    'add_people',
    {
      title: 'Add people',
      description:
        'Add people to the tab. Anyone with the link can also add themselves in the browser — ' +
        'use this when the user is setting the whole thing up for the group. Payers do not need ' +
        'a Venmo handle; they are paying the host.',
      inputSchema: {
        tabId,
        names: z.array(z.string()).min(1).describe('Display names, e.g. ["Sam", "Priya"].'),
      },
      annotations: { title: 'Add people', readOnlyHint: false, destructiveHint: false },
    },
    handler(async ({ tabId: id, names }) => {
      const tab = core.requireTab(id)
      const added = names.map((name) => core.addParticipant(tab, { name }))
      return ok({ added, tab: summary(id) })
    }),
  )

  server.registerTool(
    'update_person',
    {
      title: 'Update a person',
      description: 'Rename someone on the tab or set their Venmo handle.',
      inputSchema: {
        tabId,
        creatorToken,
        person: z.string().describe('Their participant id or current name.'),
        name: z.string().optional(),
        venmo: z.string().optional(),
      },
      annotations: { title: 'Update a person', readOnlyHint: false, destructiveHint: false },
    },
    handler(async ({ tabId: id, creatorToken: token, person, name, venmo }) => {
      core.updateParticipant(asCreator(id, token), person, { name, venmo })
      return ok(summary(id))
    }),
  )

  server.registerTool(
    'remove_person',
    {
      title: 'Remove a person',
      description: 'Remove someone from the tab. Their claims are released back to unclaimed.',
      inputSchema: { tabId, creatorToken, person: z.string().describe('Participant id or name.') },
      annotations: { title: 'Remove a person', readOnlyHint: false, destructiveHint: true },
    },
    handler(async ({ tabId: id, creatorToken: token, person }) => {
      core.removeParticipant(asCreator(id, token), person)
      return ok(summary(id))
    }),
  )

  // -- claims ----------------------------------------------------------------

  server.registerTool(
    'assign_items',
    {
      title: 'Assign items to someone',
      description:
        'Give someone a set of items. `share` is the fraction of each item they are taking — 1 ' +
        'for the whole thing, 0.5 if they split it with someone, 0 to un-claim. Shares are ' +
        'clamped to what is still unclaimed, so nobody gets double-billed. To give two people ' +
        'half each, call this twice with share 0.5.',
      inputSchema: {
        tabId,
        person: z.string().describe('Participant id or name.'),
        itemIds: z.array(z.string()).min(1).describe('Item ids from get_tab.'),
        share: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe('Fraction of each item, 0..1. Defaults to 1 (the whole item).'),
      },
      annotations: { title: 'Assign items', readOnlyHint: false, destructiveHint: false },
    },
    handler(async ({ tabId: id, person, itemIds, share }) => {
      const results = core.assignItems(core.requireTab(id), person, itemIds, share ?? 1)
      return ok({ results, tab: summary(id) })
    }),
  )

  server.registerTool(
    'split_evenly',
    {
      title: 'Split everything evenly',
      description:
        'Replace all claims with an even split of every item across the given people (or ' +
        'everyone on the tab). Tax, tip and extra costs follow automatically.',
      inputSchema: {
        tabId,
        people: z
          .array(z.string())
          .optional()
          .describe('Participant ids or names. Omit to split between everyone on the tab.'),
      },
      annotations: { title: 'Split evenly', readOnlyHint: false, destructiveHint: true },
    },
    handler(async ({ tabId: id, people }) => {
      core.splitEvenly(core.requireTab(id), people)
      return ok(summary(id))
    }),
  )

  // -- payment ---------------------------------------------------------------

  server.registerTool(
    'get_payment_link',
    {
      title: 'Get a payment link',
      description:
        'Build a prefilled Venmo link for what one person currently owes, so they can just tap ' +
        'it. Recomputed live — call it after claims are final.',
      inputSchema: { tabId, person: z.string().describe('Participant id or name.') },
      annotations: { title: 'Get a payment link', readOnlyHint: true },
    },
    handler(async ({ tabId: id, person }) => {
      const tab = core.requireTab(id)
      const p = core.resolveParticipant(tab, person)
      const s = summary(id)
      const owed = s.people.find((x) => x.id === p.id)
      return ok({
        name: p.name,
        owes: owed?.owes ?? 0,
        payTo: s.payTo,
        venmoLink: venmoPayLink({
          handle: tab.creator_venmo,
          amount: owed?.owes ?? 0,
          note: `${tab.merchant || 'SplitDumb'} — ${p.name}`,
        }),
        tabUrl: `${baseUrl}/t/${id}`,
      })
    }),
  )

  server.registerTool(
    'mark_paid',
    {
      title: 'Mark someone paid',
      description:
        'Record that a person SAYS they have paid. This is the payer\'s own unverified claim — ' +
        'SplitDumb never sees the actual Venmo transaction — so report it as "marked themselves ' +
        'paid", never as "paid". It also freezes the tab\'s items, since editing them would ' +
        'change what an already-paid person owes.',
      inputSchema: { tabId, person: z.string(), paid: z.boolean().optional().describe('Defaults to true.') },
      annotations: { title: 'Mark paid', readOnlyHint: false, destructiveHint: false },
    },
    handler(async ({ tabId: id, person, paid }) => {
      core.setPaid(core.requireTab(id), person, paid ?? true)
      return ok(summary(id))
    }),
  )

  server.registerTool(
    'confirm_payment',
    {
      title: 'Confirm a payment landed',
      description:
        'Host-only: record that the host believes this person\'s payment arrived. The host is ' +
        'asserting it (presumably after checking Venmo themselves) — nothing here verifies a ' +
        'transaction, so this is the host\'s word, not proof.',
      inputSchema: {
        tabId,
        creatorToken,
        person: z.string(),
        confirmed: z.boolean().optional().describe('Defaults to true.'),
      },
      annotations: { title: 'Confirm payment', readOnlyHint: false, destructiveHint: false },
    },
    handler(async ({ tabId: id, creatorToken: token, person, confirmed }) => {
      core.setConfirmed(asCreator(id, token), person, confirmed ?? true)
      return ok(summary(id))
    }),
  )

  return server
}

// ---- express mounting ------------------------------------------------------

// Resolve the origin to use in the share links we hand the model.
function resolveBaseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '')
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https'
  return `${proto}://${req.get('host')}`
}

export function mountMcp(app, routePath = '/mcp') {
  app.post(routePath, async (req, res) => {
    // Stateless: one throwaway server + transport per request, torn down when
    // the response closes.
    const server = buildMcpServer({ baseUrl: resolveBaseUrl(req) })
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })
    res.on('close', () => {
      transport.close().catch(() => {})
      server.close().catch(() => {})
    })
    try {
      await server.connect(transport)
      await transport.handleRequest(req, res, req.body)
    } catch (err) {
      console.error('[mcp] request failed', err)
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: req.body?.id ?? null,
        })
      }
    }
  })

  // Stateless mode has no server->client stream to open and no session to end.
  const notAllowed = (_req, res) =>
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed — this MCP endpoint is stateless; POST only.' },
      id: null,
    })
  app.get(routePath, notAllowed)
  app.delete(routePath, notAllowed)

  // Tiny discovery aid: makes it obvious in a browser that the URL is live and
  // what to point a client at.
  app.get('/.well-known/mcp.json', (req, res) => {
    res.json({
      name: SERVER_INFO.name,
      version: SERVER_INFO.version,
      description: 'Create and run SplitDumb bill-splitting tabs.',
      transport: 'streamable-http',
      url: `${resolveBaseUrl(req)}${routePath}`,
      authentication: 'none',
      instanceId: MCP_INSTANCE,
    })
  })
}

// Regenerated per process — handy for confirming which deploy answered.
const MCP_INSTANCE = randomUUID()
