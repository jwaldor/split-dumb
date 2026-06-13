import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getMyVenmo, setMyVenmo } from '../api.js'

export default function Home() {
  const navigate = useNavigate()
  const [venmo, setVenmo] = useState(getMyVenmo())
  const [recents, setRecents] = useState([])

  useEffect(() => {
    // Surface tabs this device created (creator tokens stashed in localStorage).
    const found = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      const m = key && key.match(/^splitdumb:tab:(.+):creator$/)
      if (m) found.push(m[1])
    }
    setRecents(found)
  }, [])

  function start() {
    setMyVenmo(venmo)
    navigate('/new')
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
        <button className="btn-primary mt-4 w-full" disabled={!venmo.trim()} onClick={start}>
          Start a new tab
        </button>
      </div>

      {recents.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-slate-500">Tabs you started</h2>
          <div className="mt-2 space-y-2">
            {recents.map((id) => (
              <button
                key={id}
                onClick={() => navigate(`/t/${id}`)}
                className="card flex w-full items-center justify-between p-4 text-left hover:bg-slate-50"
              >
                <span className="font-mono font-semibold">{id}</span>
                <span className="text-sm text-venmo">Open →</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
