import { useCallback, useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  api,
  getMyVenmo,
  setMyVenmo,
  getCreatorToken,
  getMyParticipantId,
  setMyParticipantId,
} from '../api.js'
import { computeTotals, money } from '../lib/calc.js'
import { venmoPayLink } from '../lib/venmo.js'
import QrCode from '../components/QrCode.jsx'

const FRACTIONS = [
  { label: '¼', value: 0.25 },
  { label: '⅓', value: 1 / 3 },
  { label: '½', value: 0.5 },
  { label: 'All', value: 1 },
]

export default function TabView() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [tab, setTab] = useState(null)
  const [error, setError] = useState(null)
  const [showShare, setShowShare] = useState(false)

  const creatorToken = getCreatorToken(id)
  const isCreator = !!creatorToken
  const [meId, setMeId] = useState(getMyParticipantId(id))

  const refresh = useCallback(async () => {
    try {
      setTab(await api.getTab(id))
    } catch (err) {
      setError(err.message)
    }
  }, [id])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 2500)
    return () => clearInterval(t)
  }, [refresh])

  if (error) {
    return (
      <Center>
        <p className="text-slate-500">{error}</p>
        <button className="btn-ghost mt-4" onClick={() => navigate('/')}>← Home</button>
      </Center>
    )
  }
  if (!tab) return <Center><p className="text-slate-400">Loading tab…</p></Center>

  const calc = computeTotals(tab)
  const me = tab.participants.find((p) => p.id === meId) || null
  const nameById = Object.fromEntries(tab.participants.map((p) => [p.id, p.name]))
  const shareUrl = `${window.location.origin}/t/${id}`

  async function join(name, venmo) {
    const { id: pid } = await api.addParticipant(id, { name, venmo })
    setMyParticipantId(id, pid)
    setMeId(pid)
    if (venmo) setMyVenmo(venmo)
    refresh()
  }

  async function claim(itemId, share) {
    if (!meId) return
    try {
      setTab(await api.setClaim(id, { participantId: meId, itemId, share }))
    } catch (err) {
      setError(err.message)
    }
  }

  async function togglePaid() {
    await api.setPaid(id, meId, me.paid ? 0 : 1)
    refresh()
  }

  async function toggleConfirm(pid, confirmed) {
    await api.confirm(id, pid, confirmed ? 1 : 0, creatorToken)
    refresh()
  }

  async function saveExtras(tax, tip) {
    setTab(await api.updateExtras(id, { tax, tip }, creatorToken))
  }

  return (
    <div className="mx-auto max-w-md px-5 py-6">
      <div className="flex items-center justify-between">
        <button onClick={() => navigate('/')} className="text-sm text-slate-400">← Home</button>
        <button onClick={() => setShowShare((s) => !s)} className="text-sm font-semibold text-venmo">
          {showShare ? 'Hide invite' : 'Invite people'}
        </button>
      </div>

      <h1 className="mt-2 text-2xl font-black">{tab.merchant || 'The tab'}</h1>
      <p className="text-sm text-slate-500">
        Pay <span className="font-semibold">@{tab.creator_venmo}</span> · {money(calc.receiptTotal, tab.currency)} total
      </p>

      {(showShare || (isCreator && tab.participants.length === 0)) && (
        <div className="card mt-4 flex flex-col items-center p-5">
          <QrCode value={shareUrl} />
          <p className="mt-3 text-center text-xs text-slate-400">Scan to hop on the tab</p>
          <button
            className="btn-ghost mt-3 w-full text-sm"
            onClick={() => navigator.clipboard?.writeText(shareUrl)}
          >
            Copy link
          </button>
          <p className="mt-1 break-all text-center text-[11px] text-slate-300">{shareUrl}</p>
        </div>
      )}

      {!me && <JoinCard onJoin={join} />}

      {/* Items */}
      <div className="mt-5 space-y-2">
        {tab.items.map((it) => {
          const covered = calc.coverage[it.id] || 0
          const myClaim = tab.claims.find((c) => c.item_id === it.id && c.participant_id === meId)
          const myShare = myClaim ? Number(myClaim.share) : 0
          const claimers = tab.claims
            .filter((c) => c.item_id === it.id)
            .map((c) => ({ name: nameById[c.participant_id], share: Number(c.share) }))
          return (
            <div key={it.id} className="card p-4">
              <div className="flex items-baseline justify-between">
                <span className="font-semibold">{it.name}</span>
                <span className="tabular-nums text-slate-600">{money(it.price, tab.currency)}</span>
              </div>

              <CoverageBar covered={covered} />
              {claimers.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {claimers.map((c, i) => (
                    <span
                      key={i}
                      className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600"
                    >
                      {c.name} {Math.round(c.share * 100)}%
                    </span>
                  ))}
                </div>
              )}

              {me && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {FRACTIONS.map((f) => (
                    <button
                      key={f.label}
                      onClick={() => claim(it.id, f.value)}
                      className={`rounded-lg px-2.5 py-1 text-sm font-semibold ${
                        Math.abs(myShare - f.value) < 0.01
                          ? 'bg-venmo text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                  <button
                    onClick={() => {
                      const pct = window.prompt('Your share of this item, in %', String(Math.round(myShare * 100) || ''))
                      if (pct == null) return
                      const v = Math.max(0, Math.min(100, parseFloat(pct) || 0)) / 100
                      claim(it.id, v)
                    }}
                    className="rounded-lg bg-slate-100 px-2.5 py-1 text-sm font-semibold text-slate-600 hover:bg-slate-200"
                  >
                    %
                  </button>
                  {myShare > 0 && (
                    <button
                      onClick={() => claim(it.id, 0)}
                      className="rounded-lg px-2.5 py-1 text-sm font-semibold text-red-500 hover:bg-red-50"
                    >
                      clear
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {calc.extras > 0 && (
        <p className="mt-3 text-center text-xs text-slate-400">
          + {money(calc.extras, tab.currency)} tax & tip, split by what you ordered
        </p>
      )}
      {calc.unclaimedSubtotal > 0.01 && (
        <p className="mt-1 text-center text-xs text-amber-600">
          {money(calc.unclaimedSubtotal, tab.currency)} of items still unclaimed
        </p>
      )}

      {/* My total */}
      {me && (
        <MyTotal
          me={calc.perParticipant.find((p) => p.id === meId)}
          tab={tab}
          isCreator={isCreator}
          onTogglePaid={togglePaid}
        />
      )}

      {/* Creator controls */}
      {isCreator && (
        <CreatorPanel tab={tab} calc={calc} onConfirm={toggleConfirm} onSaveExtras={saveExtras} />
      )}
    </div>
  )
}

function CoverageBar({ covered }) {
  const pct = Math.min(100, Math.round(covered * 100))
  const over = covered > 1.01
  return (
    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div
        className={`h-full rounded-full ${over ? 'bg-amber-500' : 'bg-venmo'}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

function JoinCard({ onJoin }) {
  const [name, setName] = useState('')
  const [venmo, setVenmo] = useState(getMyVenmo())
  const [busy, setBusy] = useState(false)
  return (
    <div className="card mt-4 p-5">
      <h2 className="font-bold">Hop on the tab</h2>
      <input
        className="input mt-3"
        placeholder="Your name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        className="input mt-2"
        placeholder="Your Venmo (optional)"
        value={venmo}
        onChange={(e) => setVenmo(e.target.value.replace(/^@/, ''))}
        autoCapitalize="off"
      />
      <button
        className="btn-primary mt-3 w-full"
        disabled={!name.trim() || busy}
        onClick={async () => {
          setBusy(true)
          try {
            await onJoin(name.trim(), venmo.trim())
          } finally {
            setBusy(false)
          }
        }}
      >
        Claim my items
      </button>
    </div>
  )
}

function MyTotal({ me, tab, isCreator, onTogglePaid }) {
  if (!me) return null
  const note = `${tab.merchant || 'SplitDumb'} — ${me.name}`
  const payUrl = venmoPayLink({ handle: tab.creator_venmo, amount: me.total, note })
  return (
    <div className="card mt-5 border-venmo/30 p-5">
      <h2 className="font-bold">You owe</h2>
      <div className="mt-2 space-y-1 text-sm text-slate-500">
        <Row label="Your items" value={money(me.subtotal, tab.currency)} />
        <Row label="Tax & tip share" value={money(me.extras, tab.currency)} />
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2 text-xl font-black">
        <span>Total</span>
        <span>{money(me.total, tab.currency)}</span>
      </div>

      {isCreator ? (
        <p className="mt-3 text-center text-xs text-slate-400">You're the host — collect from everyone below.</p>
      ) : (
        <>
          <a
            href={payUrl}
            target="_blank"
            rel="noreferrer"
            className="btn-primary mt-4 w-full"
            onClick={() => {
              if (!me.paid) setTimeout(onTogglePaid, 400)
            }}
          >
            Pay @{tab.creator_venmo} on Venmo
          </a>
          <button
            onClick={onTogglePaid}
            className={`mt-2 w-full rounded-xl py-2 text-sm font-semibold ${
              me.paid ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
            }`}
          >
            {me.paid ? '✓ Marked as paid (tap to undo)' : 'Mark as paid'}
          </button>
          {me.confirmed ? (
            <p className="mt-2 text-center text-xs font-semibold text-green-600">
              ✓ Host confirmed they got it
            </p>
          ) : (
            me.paid && <p className="mt-2 text-center text-xs text-slate-400">Waiting for host to confirm…</p>
          )}
        </>
      )}
    </div>
  )
}

function CreatorPanel({ tab, calc, onConfirm, onSaveExtras }) {
  const [tax, setTax] = useState(String(tab.tax || ''))
  const [tip, setTip] = useState(String(tab.tip || ''))
  const [savedMsg, setSavedMsg] = useState('')

  const collected = calc.perParticipant
    .filter((p) => p.confirmed)
    .reduce((s, p) => s + p.total, 0)

  return (
    <div className="mt-6">
      <h2 className="text-sm font-bold uppercase tracking-wide text-slate-400">Host tools</h2>

      <div className="card mt-2 p-5">
        <div className="flex items-center justify-between gap-3">
          <label className="text-sm font-semibold text-slate-600">Tax</label>
          <input className="input w-28 text-right" inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} />
        </div>
        <div className="mt-2 flex items-center justify-between gap-3">
          <label className="text-sm font-semibold text-slate-600">Tip</label>
          <input className="input w-28 text-right" inputMode="decimal" value={tip} onChange={(e) => setTip(e.target.value)} />
        </div>
        <button
          className="btn-ghost mt-3 w-full text-sm"
          onClick={async () => {
            await onSaveExtras(parseFloat(tax) || 0, parseFloat(tip) || 0)
            setSavedMsg('Saved')
            setTimeout(() => setSavedMsg(''), 1500)
          }}
        >
          {savedMsg || 'Update tax & tip'}
        </button>
      </div>

      <div className="card mt-3 divide-y divide-slate-100">
        {calc.perParticipant.length === 0 && (
          <p className="p-5 text-center text-sm text-slate-400">No one's joined yet. Share the QR above.</p>
        )}
        {calc.perParticipant.map((p) => (
          <div key={p.id} className="flex items-center justify-between gap-3 p-4">
            <div>
              <div className="font-semibold">{p.name}</div>
              <div className="text-sm text-slate-500">
                {money(p.total, tab.currency)}
                {p.paid ? <span className="ml-2 text-venmo">· says paid</span> : null}
              </div>
            </div>
            <button
              onClick={() => onConfirm(p.id, !p.confirmed)}
              className={`rounded-xl px-3 py-2 text-sm font-semibold ${
                p.confirmed ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
              }`}
            >
              {p.confirmed ? '✓ Got it' : 'Confirm'}
            </button>
          </div>
        ))}
      </div>

      <p className="mt-3 text-center text-sm text-slate-500">
        Collected (confirmed): <span className="font-bold text-slate-700">{money(collected, tab.currency)}</span> of{' '}
        {money(calc.receiptTotal, tab.currency)}
      </p>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}

function Center({ children }) {
  return <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">{children}</div>
}
