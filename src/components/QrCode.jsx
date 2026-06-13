import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

export default function QrCode({ value, size = 200 }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let alive = true
    QRCode.toDataURL(value, { width: size, margin: 1, color: { dark: '#0f172a', light: '#ffffff' } })
      .then((url) => alive && setSrc(url))
      .catch(() => alive && setSrc(''))
    return () => {
      alive = false
    }
  }, [value, size])

  if (!src) return <div className="animate-pulse rounded-lg bg-slate-100" style={{ width: size, height: size }} />
  return <img src={src} width={size} height={size} alt="Scan to join this tab" className="rounded-lg" />
}
