import { useState } from 'react'
import { api } from '../api.js'

// A little "got thoughts?" box that lives at the bottom of the page. Sends a
// free-text note to the server, optionally tagged with the tab you're on.
export default function Feedback({ tabId = null }) {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState(null)

  async function send() {
    if (!message.trim()) return
    setSending(true)
    setError(null)
    try {
      await api.sendFeedback(message.trim(), email.trim(), tabId)
      setSent(true)
      setMessage('')
      setEmail('')
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="mt-12 border-t border-slate-200 pt-6 text-center">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="text-sm font-semibold text-slate-400 hover:text-venmo"
        >
          💬 Got feedback?
        </button>
      ) : sent ? (
        <p className="text-sm text-slate-500">Thanks for the feedback! 🙏</p>
      ) : (
        <div className="card p-5 text-left">
          <label className="block text-sm font-semibold text-slate-600">
            Tell us what you think
          </label>
          <textarea
            className="input mt-2 min-h-[88px] resize-y"
            placeholder="What's working, what's broken, what you'd love to see…"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={2000}
            autoFocus
          />
          <input
            type="email"
            className="input mt-2"
            placeholder="Email (optional)"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={254}
            autoCapitalize="off"
            autoCorrect="off"
          />
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          <div className="mt-3 flex items-center justify-end gap-2">
            <button className="btn-ghost text-sm" onClick={() => setOpen(false)} disabled={sending}>
              Cancel
            </button>
            <button
              className="btn-primary text-sm"
              onClick={send}
              disabled={!message.trim() || sending}
            >
              {sending ? 'Sending…' : 'Send feedback'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
