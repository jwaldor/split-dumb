// Receipt OCR via OpenRouter vision models.
//
// Returns a structured object. When the image isn't a usable receipt the model
// is told to set ok:false and explain what's wrong in `issue`, so the UI can
// tell the user (blurry, not a receipt, prices cut off, etc.) instead of
// silently producing garbage.

const SYSTEM_PROMPT = `You read photos of restaurant/store receipts and extract the line items.

Respond with ONLY a JSON object (no markdown fences) of this exact shape:
{
  "ok": boolean,
  "issue": string | null,        // if ok is false, a short, friendly explanation of what's wrong with the photo
  "merchant": string | null,
  "currency": string,            // ISO code, default "USD"
  "items": [ { "name": string, "price": number } ],  // one entry per purchased line item, price is the line total
  "subtotal": number | null,
  "tax": number | null,
  "tip": number | null,          // only if printed on the receipt, else null
  "total": number | null
}

Rules:
- If the image is not a receipt, is too blurry/dark to read, or no prices are visible, set ok:false and describe the problem in "issue". Still return the other fields as best you can (or empty/null).
- Expand multi-quantity lines into the single line total shown (do not multiply yourself unless only a unit price is shown).
- Exclude subtotal/tax/tip/total rows from "items" — those go in their own fields.
- Use plain numbers, no currency symbols. Round to 2 decimals.`

export async function readReceipt(imageDataUrl) {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    return { ok: false, issue: 'Server is missing OPENROUTER_API_KEY — OCR is not configured.', items: [] }
  }
  const model = process.env.OPENROUTER_MODEL || 'openai/gpt-5.4-mini'

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-Title': 'SplitDumb',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Extract this receipt.' },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        },
      ],
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 500)}`)
  }

  const data = await res.json()
  const content = data?.choices?.[0]?.message?.content
  if (!content) throw new Error('OpenRouter returned no content')

  const parsed = parseJson(content)
  return normalize(parsed)
}

function parseJson(content) {
  try {
    return JSON.parse(content)
  } catch {
    // Strip ```json fences or surrounding prose if the model added any.
    const match = content.match(/\{[\s\S]*\}/)
    if (match) return JSON.parse(match[0])
    throw new Error('Could not parse model JSON output')
  }
}

function num(v) {
  const n = typeof v === 'string' ? parseFloat(v.replace(/[^0-9.\-]/g, '')) : v
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null
}

function normalize(p) {
  const items = Array.isArray(p?.items)
    ? p.items
        .map((it) => ({ name: String(it?.name ?? '').trim() || 'Item', price: num(it?.price) ?? 0 }))
        .filter((it) => it.price !== null)
    : []
  return {
    ok: p?.ok !== false,
    issue: p?.issue ? String(p.issue) : null,
    merchant: p?.merchant ? String(p.merchant) : null,
    currency: p?.currency ? String(p.currency) : 'USD',
    items,
    subtotal: num(p?.subtotal),
    tax: num(p?.tax),
    tip: num(p?.tip),
    total: num(p?.total),
  }
}
