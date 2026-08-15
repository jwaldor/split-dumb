import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  api,
  getCreatorToken,
  getMyParticipantId,
  setMyParticipantId,
} from '../api.js'
import { computeTotals, money, round } from '../lib/calc.js'
import { openVenmoPay } from '../lib/venmo.js'
import { fileToDataUrl } from '../lib/image.js'
import QrCode from '../components/QrCode.jsx'
import FunFact from '../components/FunFact.jsx'

const FRACTIONS = [
  { label: '¼', value: 0.25 },
  { label: '⅓', value: 1 / 3 },
  { label: '½', value: 0.5 },
]

// Name only the add-ons this tab actually has, so a tab with no card fee never
// says "extras" — "tax & tip", "tax, tip & extras", "tip & extras"…
function extrasLabel(tab) {
  const parts = []
  if (Number(tab.tax)) parts.push('tax')
  if (Number(tab.tip)) parts.push('tip')
  if (Number(tab.fees)) parts.push('extras')
  if (parts.length === 0) return 'tax & tip'
  if (parts.length === 1) return parts[0]
  return `${parts.slice(0, -1).join(', ')} & ${parts[parts.length - 1]}`
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1)

export default function TabView() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [tab, setTab] = useState(null)
  const [error, setError] = useState(null)
  // null = untouched (defaults open for the host), true/false = explicitly
  // toggled. The host's QR stays up for the whole tab — people trickle in and
  // re-scan — so only a deliberate "Hide invite" closes it.
  const [showShare, setShowShare] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [scanIssue, setScanIssue] = useState(null)
  const [editing, setEditing] = useState(false)
  const cameraRef = useRef(null)
  const uploadRef = useRef(null)

  const creatorToken = getCreatorToken(id)
  const isCreator = !!creatorToken
  const [meId, setMeId] = useState(getMyParticipantId(id))

  // Bumped on every local mutation so an in-flight poll that started earlier
  // can't clobber fresher state with a stale snapshot.
  const mutationSeq = useRef(0)
  const applyTab = useCallback((t) => {
    mutationSeq.current++
    setTab(t)
  }, [])

  // Pause polling while editing items so it can't clobber inputs mid-edit.
  const editingRef = useRef(false)
  const refresh = useCallback(async () => {
    if (editingRef.current) return
    const seq = mutationSeq.current
    try {
      const t = await api.getTab(id)
      if (editingRef.current || mutationSeq.current !== seq) return
      setTab(t)
    } catch (err) {
      setError(err.message)
    }
  }, [id])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 2500)
    return () => clearInterval(t)
  }, [refresh])

  // Derived values memoized so the 2.5s poll doesn't re-run them every tick.
  const calc = useMemo(() => (tab ? computeTotals(tab) : null), [tab])
  const nameById = useMemo(
    () => (tab ? Object.fromEntries(tab.participants.map((p) => [p.id, p.name])) : {}),
    [tab],
  )
  const shareUrl = useMemo(() => `${window.location.origin}/t/${id}`, [id])

  if (error) {
    return (
      <Center>
        <p className="text-slate-500">{error}</p>
        <button className="btn-ghost mt-4" onClick={() => navigate('/')}>← Home</button>
      </Center>
    )
  }
  if (!tab) return <Center><p className="text-slate-400">Loading tab…</p></Center>

  const me = tab.participants.find((p) => p.id === meId) || null
  const hasItems = tab.items.length > 0
  const anyPaid = tab.participants.some((p) => p.paid) // items freeze once anyone pays
  // Open by default for the host once there's something to join; guests see it
  // only if they ask for it.
  const inviteOpen = showShare ?? (isCreator && hasItems)

  async function onScan(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setScanning(true)
    setScanIssue(null)
    setError(null)
    try {
      const dataUrl = await fileToDataUrl(file)
      const res = await api.scan(id, dataUrl, creatorToken)
      applyTab(res.tab)
      if (!res.ok) setScanIssue(res.issue || 'That photo was hard to read — try again with better lighting.')
    } catch (err) {
      setError(err.message)
    } finally {
      setScanning(false)
    }
  }

  async function removeItem(itemId) {
    try {
      applyTab(await api.removeItem(id, itemId, creatorToken))
    } catch (err) {
      setError(err.message)
    }
  }

  async function addItem() {
    try {
      applyTab(await api.addItem(id, { name: '', price: 0 }, creatorToken))
    } catch (err) {
      setError(err.message)
    }
  }

  async function saveItem(itemId, name, price) {
    try {
      applyTab(await api.updateItem(id, itemId, { name, price }, creatorToken))
    } catch (err) {
      setError(err.message)
    }
  }

  function startEditing() {
    editingRef.current = true
    setEditing(true)
  }
  function stopEditing() {
    editingRef.current = false
    setEditing(false)
    refresh()
  }

  async function join(name) {
    // Payers don't need a Venmo handle — they're paying the host, not receiving.
    const { id: pid } = await api.addParticipant(id, { name })
    setMyParticipantId(id, pid)
    setMeId(pid)
    mutationSeq.current++
    refresh()
  }

  async function claim(itemId, share) {
    if (!meId) return
    try {
      applyTab(await api.setClaim(id, { participantId: meId, itemId, share }))
    } catch (err) {
      setError(err.message)
    }
  }

  async function togglePaid() {
    await api.setPaid(id, meId, me.paid ? 0 : 1)
    mutationSeq.current++
    refresh()
  }

  async function toggleConfirm(pid, confirmed) {
    await api.confirm(id, pid, confirmed ? 1 : 0, creatorToken)
    mutationSeq.current++
    refresh()
  }

  async function saveExtras({ tax, tip, fees }) {
    applyTab(await api.updateExtras(id, { tax, tip, fees }, creatorToken))
  }

  return (
    <div className="mx-auto max-w-md px-5 py-6">
      <div className="flex items-center justify-between">
        <button onClick={() => navigate('/')} className="text-sm text-slate-400">← Home</button>
        <button
          onClick={() => setShowShare(!inviteOpen)}
          className="text-sm font-semibold text-venmo"
        >
          {inviteOpen ? 'Hide invite' : 'Invite people'}
        </button>
      </div>

      <h1 className="mt-2 text-2xl font-black">{tab.merchant || 'Your tab'}</h1>
      <p className="text-sm text-slate-500">
        Pay <span className="font-semibold">@{tab.creator_venmo}</span>
        {hasItems ? <> · {money(calc.receiptTotal, tab.currency)} total</> : null}
      </p>

      {inviteOpen && (
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

      {/* Creator: scan ONE receipt to seed items (camera or file upload),
          then refine by hand. Hidden entirely once items lock (someone paid). */}
      {isCreator && !editing && !(hasItems && anyPaid) && (
        <div className="card mt-4 p-5">
          {hasItems ? (
            <button onClick={startEditing} className="btn-ghost w-full">
              ✏️ Edit / add items
            </button>
          ) : scanning ? (
            <>
              <button className="btn-primary w-full" disabled>Reading receipt…</button>
              <FunFact />
            </>
          ) : (
            <>
              <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onScan} />
              <input ref={uploadRef} type="file" accept="image/*" className="hidden" onChange={onScan} />
              <div className="flex gap-2">
                <button className="btn-primary flex-1" onClick={() => cameraRef.current?.click()}>
                  📷 Take a photo
                </button>
                <button className="btn-ghost flex-1" onClick={() => uploadRef.current?.click()}>
                  🖼️ Upload a file
                </button>
              </div>
              <p className="mt-2 text-center text-xs text-slate-400">
                Scan or upload one receipt to load items — then edit or add by hand.
              </p>
            </>
          )}
        </div>
      )}

      {/* Creator: edit / add items by hand */}
      {isCreator && editing && (
        <EditItems
          items={tab.items}
          currency={tab.currency}
          onEdit={saveItem}
          onAdd={addItem}
          onRemove={removeItem}
          onDone={stopEditing}
        />
      )}

      {scanIssue && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <span className="font-semibold">Heads up:</span> {scanIssue}
        </div>
      )}

      {/* Empty state for non-creators */}
      {!hasItems && !isCreator && (
        <div className="card mt-4 p-6 text-center text-slate-500">
          The host is still setting up this tab. Check back in a moment. 🧾
        </div>
      )}

      {hasItems && !me && <JoinCard onJoin={join} />}

      {/* Items */}
      {hasItems && !editing && (
        <div className="mt-5 space-y-2">
          {tab.items.map((it) => {
            const claimsForItem = tab.claims.filter((c) => c.item_id === it.id)
            const myShare = Number(claimsForItem.find((c) => c.participant_id === meId)?.share || 0)
            const othersShare = claimsForItem
              .filter((c) => c.participant_id !== meId)
              .reduce((s, c) => s + Number(c.share), 0)
            const covered = othersShare + myShare
            const remaining = Math.max(0, round(1 - othersShare)) // most I can still take
            const fullyTaken = remaining <= 0.001 && myShare <= 0
            const claimers = claimsForItem.map((c) => ({
              name: nameById[c.participant_id],
              share: Number(c.share),
            }))

            return (
              <div key={it.id} className="card p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold">{it.name}</span>
                  <span className="tabular-nums text-slate-600">{money(it.price, tab.currency)}</span>
                </div>

                <CoverageBar covered={covered} />
                {claimers.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {claimers.map((c, i) => (
                      <span key={i} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                        {c.name} {Math.round(c.share * 100)}%
                      </span>
                    ))}
                  </div>
                )}

                {me && (
                  <div className="mt-3">
                    {fullyTaken ? (
                      <span className="text-xs font-semibold text-slate-400">Fully claimed by others</span>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {FRACTIONS.map((f) => {
                          const disabled = f.value > remaining + 0.01 && Math.abs(myShare - f.value) > 0.01
                          const active = Math.abs(myShare - f.value) < 0.01
                          return (
                            <button
                              key={f.label}
                              disabled={disabled}
                              onClick={() => claim(it.id, f.value)}
                              className={`rounded-lg px-2.5 py-1 text-sm font-semibold ${
                                active
                                  ? 'bg-venmo text-white'
                                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-40 disabled:hover:bg-slate-100'
                              }`}
                            >
                              {f.label}
                            </button>
                          )
                        })}
                        <button
                          onClick={() => claim(it.id, 1)}
                          className={`rounded-lg px-2.5 py-1 text-sm font-semibold ${
                            myShare > 0 && Math.abs(covered - 1) < 0.01
                              ? 'bg-venmo text-white'
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                          }`}
                        >
                          {othersShare > 0.001 ? 'Rest' : 'All'}
                        </button>
                        <button
                          onClick={() => {
                            const maxPct = Math.round(remaining * 100)
                            const pct = window.prompt(
                              `Your share of this item, in % (up to ${maxPct}% left)`,
                              String(Math.round(myShare * 100) || ''),
                            )
                            if (pct == null) return
                            const v = Math.min(remaining, Math.max(0, parseFloat(pct) || 0) / 100)
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
                        {remaining < 0.999 && remaining > 0.001 && (
                          <span className="ml-1 text-[11px] text-slate-400">{Math.round(remaining * 100)}% left</span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {hasItems && !editing && calc.extras > 0 && (
        <p className="mt-3 text-center text-xs text-slate-400">
          + {money(calc.extras, tab.currency)} {extrasLabel(tab)}, split by what you ordered
        </p>
      )}
      {hasItems && !editing && calc.unclaimedSubtotal > 0.01 && (
        <p className="mt-1 text-center text-xs text-amber-600">
          {money(calc.unclaimedSubtotal, tab.currency)} of items still unclaimed
        </p>
      )}

      {/* My total */}
      {hasItems && !editing && me && (
        <MyTotal
          me={calc.perParticipant.find((p) => p.id === meId)}
          tab={tab}
          isCreator={isCreator}
          onTogglePaid={togglePaid}
        />
      )}

      {/* Creator controls */}
      {isCreator && !editing && hasItems && (
        <CreatorPanel tab={tab} calc={calc} onConfirm={toggleConfirm} onSaveExtras={saveExtras} />
      )}
    </div>
  )
}

function EditItems({ items, currency, onEdit, onAdd, onRemove, onDone }) {
  return (
    <div className="card mt-4 p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-bold">Edit items</h2>
        <button onClick={onDone} className="text-sm font-semibold text-venmo">Done</button>
      </div>
      <div className="mt-3 space-y-2">
        {items.map((it) => (
          <ItemEditor key={it.id} item={it} currency={currency} onEdit={onEdit} onRemove={onRemove} />
        ))}
        {items.length === 0 && (
          <p className="py-2 text-center text-sm text-slate-400">No items yet — add one below.</p>
        )}
      </div>
      <button onClick={onAdd} className="mt-3 text-sm font-semibold text-venmo">+ Add item</button>
      <p className="mt-3 text-[11px] text-slate-400">Changes save as you go. Tap Done when you're finished.</p>
    </div>
  )
}

// One editable row. Holds local input state and commits on blur so the
// (paused) poll can't fight your typing.
function ItemEditor({ item, currency, onEdit, onRemove }) {
  const [name, setName] = useState(item.name)
  const [price, setPrice] = useState(String(item.price ?? ''))
  const commit = () => {
    const p = parseFloat(price) || 0
    if (name !== item.name || p !== Number(item.price)) onEdit(item.id, name.trim() || 'Item', p)
  }
  return (
    <div className="flex items-center gap-2">
      <input
        className="input flex-1"
        placeholder="Item name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
      />
      <input
        className="input w-24 text-right"
        placeholder="0.00"
        inputMode="decimal"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        onBlur={commit}
      />
      <button onClick={() => onRemove(item.id)} className="px-1 text-slate-300 hover:text-red-500" aria-label="Remove item">
        ✕
      </button>
    </div>
  )
}

function CoverageBar({ covered }) {
  const pct = Math.min(100, Math.round(covered * 100))
  return (
    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div className="h-full rounded-full bg-venmo" style={{ width: `${pct}%` }} />
    </div>
  )
}

function JoinCard({ onJoin }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <div className="card mt-4 p-5">
      <h2 className="font-bold">Hop on the tab</h2>
      <input
        className="input mt-3"
        placeholder="Your name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && name.trim() && !busy) e.currentTarget.blur()
        }}
      />
      <button
        className="btn-primary mt-3 w-full"
        disabled={!name.trim() || busy}
        onClick={async () => {
          setBusy(true)
          try {
            await onJoin(name.trim())
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
  return (
    <div className="card mt-5 border-venmo/30 p-5">
      <h2 className="font-bold">You owe</h2>
      <div className="mt-2 space-y-1 text-sm text-slate-500">
        <Row label="Your items" value={money(me.subtotal, tab.currency)} />
        <Row label={`${capitalize(extrasLabel(tab))} share`} value={money(me.extras, tab.currency)} />
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2 text-xl font-black">
        <span>Total</span>
        <span>{money(me.total, tab.currency)}</span>
      </div>

      {isCreator ? (
        <p className="mt-3 text-center text-xs text-slate-400">You're the host — collect from everyone below.</p>
      ) : (
        <>
          <button
            className="btn-primary mt-4 w-full"
            onClick={() => {
              openVenmoPay({ handle: tab.creator_venmo, amount: me.total, note })
              if (!me.paid) setTimeout(onTogglePaid, 600)
            }}
          >
            Pay @{tab.creator_venmo} on Venmo
          </button>
          <button
            onClick={onTogglePaid}
            className={`mt-2 w-full rounded-xl py-2 text-sm font-semibold ${
              me.paid ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
            }`}
          >
            {me.paid ? '✓ Marked as paid (tap to undo)' : 'Mark as paid'}
          </button>
          {me.confirmed ? (
            <p className="mt-2 text-center text-xs font-semibold text-green-600">✓ Host confirmed they got it</p>
          ) : (
            me.paid && <p className="mt-2 text-center text-xs text-slate-400">Waiting for host to confirm…</p>
          )}
        </>
      )}
    </div>
  )
}

// Tax / tip / extra costs. Every keystroke saves — no button to press. The
// write is debounced so typing "12.50" is one request, not five.
const SAVE_DEBOUNCE_MS = 500

function ExtrasEditor({ tab, calc, onSaveExtras }) {
  const [draft, setDraft] = useState({
    tax: String(tab.tax || ''),
    tip: String(tab.tip || ''),
    fees: String(tab.fees || ''),
  })
  const [status, setStatus] = useState('') // '', 'saving', 'saved', or an error
  const timer = useRef(null)
  const pending = useRef(false)

  // Adopt changes made elsewhere (another device, or an MCP client) — but never
  // while we have an edit in flight, or we'd yank the field out from under the
  // person typing in it.
  useEffect(() => {
    if (pending.current) return
    setDraft({
      tax: String(tab.tax || ''),
      tip: String(tab.tip || ''),
      fees: String(tab.fees || ''),
    })
  }, [tab.tax, tab.tip, tab.fees])

  const save = useCallback(
    async (next) => {
      setStatus('saving')
      try {
        await onSaveExtras({
          tax: parseFloat(next.tax) || 0,
          tip: parseFloat(next.tip) || 0,
          fees: parseFloat(next.fees) || 0,
        })
        pending.current = false
        setStatus('saved')
        setTimeout(() => setStatus((s) => (s === 'saved' ? '' : s)), 1200)
      } catch (err) {
        pending.current = false
        setStatus(err.message)
      }
    },
    [onSaveExtras],
  )

  // `flush` skips the debounce — used by the tip % buttons, where there's no
  // more typing coming.
  const edit = useCallback(
    (field, value, { flush = false } = {}) => {
      const next = { ...draft, [field]: value }
      setDraft(next)
      pending.current = true
      clearTimeout(timer.current)
      if (flush) save(next)
      else timer.current = setTimeout(() => save(next), SAVE_DEBOUNCE_MS)
    },
    [draft, save],
  )

  // Don't strand an unsaved keystroke if the host navigates away mid-edit.
  useEffect(() => () => clearTimeout(timer.current), [])

  const fields = [
    { key: 'tax', label: 'Tax' },
    { key: 'tip', label: 'Tip' },
    { key: 'fees', label: 'Extra costs', hint: 'Card fee, service charge, delivery…' },
  ]

  return (
    <div className="card mt-2 p-5">
      {fields.map((f, i) => (
        <div key={f.key} className={i === 0 ? '' : 'mt-2'}>
          <div className="flex items-center justify-between gap-3">
            <label htmlFor={`extras-${f.key}`} className="text-sm font-semibold text-slate-600">
              {f.label}
            </label>
            <input
              id={`extras-${f.key}`}
              className="input w-28 text-right"
              inputMode="decimal"
              placeholder="0.00"
              value={draft[f.key]}
              onChange={(e) => edit(f.key, e.target.value)}
              onBlur={(e) => edit(f.key, e.target.value, { flush: true })}
            />
          </div>
          {f.hint && <p className="mt-0.5 text-[11px] text-slate-400">{f.hint}</p>}
        </div>
      ))}

      <div className="mt-3 flex gap-2">
        {[15, 18, 20, 25].map((p) => (
          <button
            key={p}
            onClick={() => edit('tip', String(round((calc.receiptSubtotal * p) / 100)), { flush: true })}
            className="btn-ghost flex-1 px-0 text-sm"
          >
            {p}%
          </button>
        ))}
      </div>

      <p className="mt-3 flex items-center justify-between text-[11px] text-slate-400">
        <span>Tip % is calculated on the pre-tax subtotal.</span>
        <span
          className={
            status === 'saved'
              ? 'font-semibold text-green-600'
              : status && status !== 'saving'
                ? 'font-semibold text-red-600'
                : ''
          }
        >
          {status === 'saving' ? 'Saving…' : status === 'saved' ? '✓ Saved' : status}
        </span>
      </p>
    </div>
  )
}

function CreatorPanel({ tab, calc, onConfirm, onSaveExtras }) {
  const collected = calc.perParticipant.filter((p) => p.confirmed).reduce((s, p) => s + p.total, 0)

  return (
    <div className="mt-6">
      <h2 className="text-sm font-bold uppercase tracking-wide text-slate-400">Host tools</h2>

      <ExtrasEditor tab={tab} calc={calc} onSaveExtras={onSaveExtras} />

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
