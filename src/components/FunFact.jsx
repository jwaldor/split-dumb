import { useEffect, useState } from 'react'
import { RECEIPT_FACTS } from '../lib/receiptFacts.js'

// Rotating receipt trivia to entertain during the (usually short) OCR wait.
export default function FunFact() {
  const [i, setI] = useState(() => Math.floor(Math.random() * RECEIPT_FACTS.length))
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % RECEIPT_FACTS.length), 4000)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50 p-3 text-center">
      <p className="text-[11px] font-bold uppercase tracking-wide text-venmo">🧾 Did you know?</p>
      <p className="mt-1 text-sm text-slate-600">{RECEIPT_FACTS[i]}</p>
    </div>
  )
}
