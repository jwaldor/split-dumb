import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, getMyVenmo, setMyVenmo, setCreatorToken, getCreatedTabs } from '../api.js'

function formatWhen(ms) {
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function Home() {
  const navigate = useNavigate()
  const [venmo, setVenmo] = useState(getMyVenmo())
  const [recents, setRecents] = useState([])
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    // Surface tabs this device created (creator tokens stashed in localStorage),
    // newest first, labeled by merchant + when they were started.
    getCreatedTabs().then(setRecents).catch(() => {})
  }, [])

  async function start() {
    setMyVenmo(venmo)
    setStarting(true)
    setError(null)
    try {
      const { id, creatorToken } = await api.createTab(venmo)
      setCreatorToken(id, creatorToken)
      navigate(`/t/${id}`)
    } catch (err) {
      setError(err.message)
      setStarting(false)
    }
  }

  return (
    <div className="mx-auto max-w-md px-5 py-10">
      <div className="text-center">
        <h1 className="text-4xl font-black tracking-tight">
          Split<span className="text-venmo">Dumb</span>
        </h1>
        <p className="mt-2 text-slate-500">
          Snap a receipt. Share a code. Everyone grabs their stuff and Venmos you. No accounts.
        </p>
      </div>

      <div className="card mt-8 p-5">
        <label className="block text-sm font-semibold text-slate-600">Your Venmo handle</label>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-slate-400">@</span>
          <input
            className="input"
            placeholder="your-venmo"
            value={venmo}
            onChange={(e) => setVenmo(e.target.value.replace(/^@/, ''))}
            autoCapitalize="off"
            autoCorrect="off"
          />
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Saved on this device only — it's where people will pay you.
        </p>
        <button className="btn-primary mt-4 w-full" disabled={!venmo.trim() || starting} onClick={start}>
          {starting ? 'Starting…' : 'Start a new tab'}
        </button>
        {error && <p className="mt-2 text-center text-sm text-red-600">{error}</p>}
      </div>

      <button
        onClick={() => navigate('/plugin')}
        className="card mt-3 flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-slate-50"
      >
        <span className="min-w-0">
          <span className="block font-semibold">Use it from Claude or ChatGPT</span>
          <span className="block text-xs text-slate-400">
            Send your assistant the receipt — it builds the tab for you
          </span>
        </span>
        <span className="shrink-0 text-sm text-venmo">→</span>
      </button>

      {recents.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-slate-500">Tabs you started</h2>
          <div className="mt-2 space-y-2">
            {recents.map((t) => (
              <button
                key={t.id}
                onClick={() => navigate(`/t/${t.id}`)}
                className="card flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-slate-50"
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{t.merchant || 'Untitled tab'}</span>
                  <span className="block text-xs text-slate-400">{formatWhen(t.created_at)}</span>
                </span>
                <span className="shrink-0 text-sm text-venmo">Open →</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
