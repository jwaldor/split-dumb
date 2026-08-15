// Public "how do I use SplitDumb from Claude / ChatGPT" page.
//
// The connector URL is derived from wherever this page is being served, so the
// instructions are always right for this deployment (localhost included).

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

const MARKETPLACE = 'jwaldor/split-dumb'

function CopyBox({ text, label }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="mt-2">
      {label && <p className="mb-1 text-xs font-semibold text-slate-500">{label}</p>}
      <div className="flex items-stretch gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono text-[13px] text-slate-700">
          {text}
        </code>
        <button
          className="btn-ghost shrink-0 px-3 text-sm"
          onClick={() => {
            navigator.clipboard?.writeText(text)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
        >
          {copied ? '✓' : 'Copy'}
        </button>
      </div>
    </div>
  )
}

function Step({ n, title, children }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-venmo text-xs font-bold text-white">
        {n}
      </span>
      <div className="min-w-0 flex-1 pb-5">
        <p className="font-semibold leading-6">{title}</p>
        <div className="mt-1 text-sm text-slate-600">{children}</div>
      </div>
    </li>
  )
}

const TOOLS = [
  ['create_tab', 'Start a tab, optionally with all the line items at once'],
  ['get_tab', 'Full state — items, claims, and what each person owes'],
  ['get_share_link', 'The link whose page shows the QR others scan to join'],
  ['update_tab', 'Merchant, currency, Venmo handle, tax, tip, extra costs'],
  ['add_items / update_item / remove_item / clear_items', 'Edit the receipt'],
  ['add_people / update_person / remove_person', 'Manage who’s on the tab'],
  ['assign_items', 'Give someone items — whole or a fraction'],
  ['split_evenly', 'Even split across everyone'],
  ['get_payment_link', 'Prefilled Venmo link for one person’s total'],
  ['mark_paid / confirm_payment', 'Track who paid and what actually landed'],
  ['delete_tab', 'Delete a tab and everything on it'],
]

export default function PluginInfo() {
  const navigate = useNavigate()
  const origin = useMemo(() => window.location.origin, [])
  const mcpUrl = `${origin}/mcp`

  return (
    <div className="mx-auto max-w-2xl px-5 py-10">
      <button onClick={() => navigate('/')} className="text-sm text-slate-400">
        ← Home
      </button>

      <h1 className="mt-3 text-3xl font-black tracking-tight">
        Split<span className="text-venmo">Dumb</span> for Claude &amp; ChatGPT
      </h1>
      <p className="mt-2 text-slate-500">
        Hand your assistant a photo of the receipt. It reads the items, builds the tab, and gives you
        a link to show the table. Everything you can do in the app, it can do too.
      </p>

      {/* What it actually is */}
      <div className="card mt-8 p-5">
        <h2 className="font-bold">How it works</h2>
        <p className="mt-2 text-sm text-slate-600">
          SplitDumb exposes itself as an <strong>MCP server</strong> — a small set of tools any
          MCP-speaking assistant can call. Connect it once and your assistant can create tabs, fix
          items, split things, and check who’s paid, on your behalf.
        </p>
        <p className="mt-3 text-sm text-slate-600">
          <strong>The assistant reads the receipt itself.</strong> There’s no scanning tool in the
          connector on purpose: Claude and ChatGPT already see images, so they read your photo
          directly and show you the extracted items before anything is written to a tab. Your photo
          never touches SplitDumb’s OCR.
        </p>
        <p className="mt-3 text-sm text-slate-600">
          People still join the way they always do — by <strong>scanning the QR code</strong> on the
          tab page. So the assistant hands you the tab link; you open it and let everyone scan.
        </p>
        <CopyBox label="Connector URL (Streamable HTTP, no auth)" text={mcpUrl} />
      </div>

      {/* Claude */}
      <div className="card mt-4 p-5">
        <h2 className="font-bold">Claude</h2>

        <p className="mt-3 text-sm font-semibold text-slate-700">Claude Code — install the plugin</p>
        <p className="mt-1 text-sm text-slate-600">
          The plugin bundles the connector <em>and</em> a skill that teaches Claude the whole
          workflow, so it knows to read your receipt itself and to give you the QR link.
        </p>
        <CopyBox text={`/plugin marketplace add ${MARKETPLACE}`} />
        <CopyBox text="/plugin install splitdumb@splitdumb" />
        <p className="mt-2 text-xs text-slate-400">
          Pointing at a different deployment? Edit <code>plugin/.mcp.json</code> in the installed
          plugin and swap the URL.
        </p>

        <p className="mt-5 text-sm font-semibold text-slate-700">Claude desktop &amp; web</p>
        <p className="mt-1 text-sm text-slate-600">
          Settings → Connectors → <strong>Add custom connector</strong>, then paste the connector URL
          above. No API key, no OAuth.
        </p>
      </div>

      {/* ChatGPT */}
      <div className="card mt-4 p-5">
        <h2 className="font-bold">ChatGPT</h2>
        <p className="mt-2 text-sm text-slate-600">
          ChatGPT connects to the same MCP server. Turn on{' '}
          <strong>Settings → Connectors → Advanced → Developer mode</strong>, then add a connector
          with the URL above and no authentication.
        </p>
        <p className="mt-3 text-sm text-slate-600">
          ChatGPT has no plugin format to install the skill into, so paste the workflow into your
          prompt (or a Project’s instructions) if you want the same hand-holding — the short version
          is: <em>read the receipt yourself, then give me the tab link so people can scan the QR.</em>
        </p>
      </div>

      {/* Walkthrough */}
      <div className="card mt-4 p-5">
        <h2 className="font-bold">What using it looks like</h2>
        <ol className="mt-4">
          <Step n="1" title="Send a photo of the receipt">
            “Split this between me and 3 friends, I’m @your-venmo.” The assistant reads the line
            items off the photo and shows you what it got so you can correct it.
          </Step>
          <Step n="2" title="It creates the tab">
            Items, tax, tip, and any extra costs go in. You get a link back — plus a{' '}
            <strong>creator token</strong>, which is the secret that lets it edit the tab later.
            Worth saving.
          </Step>
          <Step n="3" title="Open the link, everyone scans the QR">
            The tab page shows a QR code. Everyone scans it, types their name, and taps what they
            had. Or tell the assistant who had what and it assigns items for them.
          </Step>
          <Step n="4" title="Ask who owes what">
            “Where are we at?” gets you every person’s total with tax, tip and extras already split
            proportionally — plus prefilled Venmo links to send out.
          </Step>
        </ol>
      </div>

      {/* Tools */}
      <div className="card mt-4 p-5">
        <h2 className="font-bold">Tools it gets</h2>
        <div className="mt-3 divide-y divide-slate-100">
          {TOOLS.map(([name, what]) => (
            <div key={name} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:gap-4">
              <code className="shrink-0 font-mono text-[13px] text-venmo sm:w-72">{name}</code>
              <span className="text-sm text-slate-600">{what}</span>
            </div>
          ))}
        </div>
        <p className="mt-4 text-sm text-slate-600">
          Reading a tab needs nothing but its id — that’s the shared link. Host actions (editing
          items, changing tax and tip, confirming payments, deleting) require the creator token
          handed out when the tab is made.
        </p>
      </div>

      <p className="mt-8 text-center text-sm text-slate-400">
        <a className="font-semibold text-venmo" href="https://github.com/jwaldor/split-dumb">
          Source on GitHub
        </a>
      </p>
    </div>
  )
}
