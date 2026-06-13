import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, getMyVenmo, setCreatorToken } from '../api.js'
import { money, round } from '../lib/calc.js'

// Downscale a captured photo to a reasonable size before sending to OCR.
function fileToDataUrl(file, maxDim = 1600) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
        const w = Math.round(img.width * scale)
        const h = Math.round(img.height * scale)
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        canvas.getContext('2d').drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.85))
      }
      img.onerror = reject
      img.src = reader.result
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

const blankItem = () => ({ name: '', price: '' })

export default function CreateTab() {
  const navigate = useNavigate()
  const venmo = getMyVenmo()
  const fileRef = useRef(null)

  const [merchant, setMerchant] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [items, setItems] = useState([blankItem()])
  const [tax, setTax] = useState('')
  const [tip, setTip] = useState('')
  const [scanning, setScanning] = useState(false)
  const [issue, setIssue] = useState(null)
  const [error, setError] = useState(null)
  const [creating, setCreating] = useState(false)

  if (!venmo) {
    navigate('/')
    return null
  }

  const subtotal = items.reduce((s, it) => s + (parseFloat(it.price) || 0), 0)
  const total = round(subtotal + (parseFloat(tax) || 0) + (parseFloat(tip) || 0))

  async function onPhoto(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!file) return
    setScanning(true)
    setIssue(null)
    setError(null)
    try {
      const dataUrl = await fileToDataUrl(file)
      const r = await api.ocr(dataUrl)
      if (r.merchant) setMerchant(r.merchant)
      if (r.currency) setCurrency(r.currency)
      if (Array.isArray(r.items) && r.items.length) {
        setItems(r.items.map((it) => ({ name: it.name, price: String(it.price) })))
      }
      if (r.tax != null) setTax(String(r.tax))
      if (r.tip != null) setTip(String(r.tip))
      if (!r.ok) setIssue(r.issue || 'The photo was hard to read — please check the items below.')
    } catch (err) {
      setError(err.message)
    } finally {
      setScanning(false)
    }
  }

  function setItem(i, patch) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)))
  }
  const addItem = () => setItems((prev) => [...prev, blankItem()])
  const removeItem = (i) => setItems((prev) => prev.filter((_, idx) => idx !== i))

  function applyTipPercent(pct) {
    setTip(String(round((subtotal * pct) / 100)))
  }

  async function create() {
    const cleaned = items
      .map((it) => ({ name: it.name.trim(), price: parseFloat(it.price) }))
      .filter((it) => it.name && Number.isFinite(it.price))
    if (cleaned.length === 0) {
      setError('Add at least one item with a name and price.')
      return
    }
    setCreating(true)
    setError(null)
    try {
      const { id, creatorToken } = await api.createTab({
        creatorVenmo: venmo,
        merchant: merchant.trim() || null,
        currency,
        items: cleaned,
        tax: parseFloat(tax) || 0,
        tip: parseFloat(tip) || 0,
      })
      setCreatorToken(id, creatorToken)
      navigate(`/t/${id}`)
    } catch (err) {
      setError(err.message)
      setCreating(false)
    }
  }

  return (
    <div className="mx-auto max-w-md px-5 py-8">
      <button onClick={() => navigate('/')} className="text-sm text-slate-400">← Home</button>
      <h1 className="mt-2 text-2xl font-black">New tab</h1>

      {/* Scan */}
      <div className="card mt-4 p-5">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={onPhoto}
        />
        <button className="btn-primary w-full" disabled={scanning} onClick={() => fileRef.current?.click()}>
          {scanning ? 'Reading receipt…' : '📷 Scan a receipt'}
        </button>
        <p className="mt-2 text-center text-xs text-slate-400">or just add items by hand below</p>
      </div>

      {issue && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <span className="font-semibold">Heads up about that photo:</span> {issue}
        </div>
      )}
      {error && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      {/* Items */}
      <div className="card mt-4 p-5">
        <input
          className="input mb-3 font-semibold"
          placeholder="Place / merchant (optional)"
          value={merchant}
          onChange={(e) => setMerchant(e.target.value)}
        />
        <div className="space-y-2">
          {items.map((it, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                className="input flex-1"
                placeholder="Item"
                value={it.name}
                onChange={(e) => setItem(i, { name: e.target.value })}
              />
              <input
                className="input w-24"
                placeholder="0.00"
                inputMode="decimal"
                value={it.price}
                onChange={(e) => setItem(i, { price: e.target.value })}
              />
              <button
                onClick={() => removeItem(i)}
                className="px-2 text-slate-300 hover:text-red-500"
                aria-label="Remove item"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <button onClick={addItem} className="mt-3 text-sm font-semibold text-venmo">+ Add item</button>
      </div>

      {/* Tax & tip */}
      <div className="card mt-4 p-5">
        <div className="flex items-center justify-between gap-3">
          <label className="text-sm font-semibold text-slate-600">Tax</label>
          <input
            className="input w-28 text-right"
            placeholder="0.00"
            inputMode="decimal"
            value={tax}
            onChange={(e) => setTax(e.target.value)}
          />
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <label className="text-sm font-semibold text-slate-600">Tip</label>
          <input
            className="input w-28 text-right"
            placeholder="0.00"
            inputMode="decimal"
            value={tip}
            onChange={(e) => setTip(e.target.value)}
          />
        </div>
        <div className="mt-3 flex gap-2">
          {[15, 18, 20, 25].map((p) => (
            <button key={p} onClick={() => applyTipPercent(p)} className="btn-ghost flex-1 px-0 text-sm">
              {p}%
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Receipt didn't show the post-tip total? Add the tip here — it gets split across everyone in
          proportion to what they ordered.
        </p>
      </div>

      {/* Summary + create */}
      <div className="card mt-4 p-5">
        <div className="flex justify-between text-sm text-slate-500">
          <span>Subtotal</span>
          <span>{money(subtotal, currency)}</span>
        </div>
        <div className="mt-1 flex justify-between text-lg font-bold">
          <span>Total</span>
          <span>{money(total, currency)}</span>
        </div>
      </div>

      <button className="btn-primary mt-4 w-full" disabled={creating} onClick={create}>
        {creating ? 'Creating…' : 'Create tab & get QR code'}
      </button>
    </div>
  )
}
