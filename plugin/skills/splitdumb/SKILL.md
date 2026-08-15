---
name: splitdumb
description: Split a restaurant bill, receipt, or group expense between people and collect the money over Venmo, using the SplitDumb tools (create_tab, add_items, assign_items, get_share_link, get_payment_link…). Use whenever someone wants to split a check or receipt, work out who owes what after a group meal or trip, share a bill with friends or roommates, or send people a link to pay their share — including when they paste or upload a photo of a receipt and ask you to divide it up.
---

# SplitDumb

SplitDumb splits a bill without anyone making an account. You build a **tab**
(the items, the tax, the tip, the extras), everyone else opens one **link**,
claims what they ordered, and pays the host on Venmo.

## The one rule that shapes everything

**There is no receipt-scanning tool, on purpose.** You are the vision model.
When someone hands you a receipt photo, *you* read it and pass structured line
items to `create_tab` or `add_items`. Never ask the user to upload the photo
into the app instead — that is a worse experience and it isn't what the tools
are for.

Before writing items to a tab, show the user what you read:

> From the receipt: 2× carnitas taco $9.00, burrito $12.00, horchata $4.00.
> Tax $2.10, tip $5.00. Subtotal $25.00, total $32.10 — does that match?

Receipts get misread. Confirming a 6-line list costs the user two seconds and
saves a wrong tab that people have already paid into.

If a line has a quantity, either pass the **line total** as `price`, or pass the
unit price plus `quantity` and let the server multiply.

## The flow

### 1. Create the tab

`create_tab` needs the **host's Venmo handle** — the person everyone pays. Ask
for it if you don't know it. You can seed everything in one call:

```
create_tab(
  creatorVenmo: "jordan-w",
  merchant: "Taco Bar",
  items: [ {name: "Carnitas taco", price: 4.50, quantity: 2}, … ],
  tax: 2.10, tip: 5.00, extraCosts: 1.20
)
```

You get back three things:

| | |
|---|---|
| `tabId` | how you address the tab in later calls |
| `url` | **the link to give the user** (see below) |
| `creatorToken` | the host's secret — required for every host action |

### 2. Hand over the link — this is how people join

People join the tab by **scanning a QR code**. That QR lives on the tab page, so
the user has to actually open `url` and show their screen to the table (or
forward the link in a group chat). You cannot render the QR yourself, and there
is no way onto a tab without the link.

So always end tab creation by giving them the URL, plainly:

> Your tab is ready: **https://splitdumb-production.up.railway.app/t/aK4mZ2xQ**
>
> Open it and let everyone scan the QR code on that page — they type their name
> and tap the items they had. You'll see their totals come in live.

`get_share_link` re-fetches it any time you need it again.

### 3. Get everyone their items

Two ways, and you should say which one you're doing:

- **Let people claim their own** (the default, and the point of the app) — they
  scan the QR and tap their items. You don't do anything; just tell the user to
  check back.
- **Do it for them** — `add_people` with the names, then `assign_items` or
  `split_evenly`. Good when the user is sitting there telling you who had what,
  or when the group has already left.

`assign_items` takes a `share` from 0 to 1. Whole item → `1` (the default).
Two people splitting one plate → call it twice with `0.5`. Shares are clamped
to what's still unclaimed, so nobody is billed twice for the same burrito.
People can be named by their **id or their name** — "Priya" works fine.

### 4. Report and collect

`get_tab` returns everything already computed — per person: their items
subtotal, their share of the extras, and what they owe. Don't do the arithmetic
yourself; read it off.

`get_payment_link` builds a prefilled Venmo link for one person's current total.
Send those once claims are final.

`mark_paid` records that someone says they paid; `confirm_payment` (host only)
records that the money actually landed.

## Offer to keep an eye on it

Chasing people for money is the worst part of splitting a bill, and it's the
part you can actually take off the user's hands. **If you can schedule recurring
work** (ChatGPT tasks, Claude scheduled tasks, cron — whatever your client
gives you), offer to watch the tab once it's live and people are on it.

Offer it *once*, right after the tab is set up, and keep the menu short:

> Want me to keep an eye on this? I can:
> **a)** send you a daily update — how much has come in, who's still out;
> **b)** stay quiet unless it stalls — I'll nudge you if nobody new has paid for
> a couple of days;
> **c)** ping you once, when everyone's paid.
>
> Or nothing at all, and you just ask me whenever.

If they pick one, schedule a task that calls `get_tab` with the tab id and
reports against that rule. **(a)** is the safe default if they say "yes" without
choosing. Don't invent a fourth option or a clever hybrid on the first ask — let
them refine it after they've seen one.

Three things make this work properly:

- **A scheduled run starts cold.** Put the `tabId` and what to report *in the
  task's own instructions* — it won't remember this conversation.
- **Keep it read-only.** `get_tab` needs no token, so the recurring task never
  has to carry the `creatorToken`. Don't put the secret in a scheduled job.
- **Say when it ends.** Stop once everyone's settled, and tell the user you've
  stopped. A reminder about a bill that closed last week is worse than no
  reminder.

What to read off `get_tab`: each person has `saysPaid` (they claim they paid)
and `hostConfirmed` (the host says the money arrived). "Everyone's paid" means
every person has `saysPaid` — mention any still waiting on `hostConfirmed`, but
don't treat unconfirmed as unpaid. `unclaimedSubtotal` above zero means people
still haven't claimed their items, which is a different problem worth flagging
in the same update.

If you *can't* schedule anything, don't fake it — no "I'll check back tomorrow."
Say the user can ask any time and you'll pull the current state.

## How the money splits

- Every claim is a **fraction of an item**, not a dollar amount.
- Tax, tip, and extra costs are split **proportionally to what each person
  ordered** — someone with a $30 steak carries more of the tip than someone with
  a $6 salad.
- Items nobody claims are **eaten by the host**. `get_tab` reports
  `unclaimedSubtotal`; if it's not zero, tell the user — it usually means
  somebody hasn't claimed yet, not that the math is off.

**Extra costs** (`extraCosts`) are anything on top of tax and tip: credit-card
surcharge, service charge, delivery, a corkage fee. Put them there rather than
padding the tip, so the tab reads honestly and the tip % buttons still work.

## The creator token

`creatorToken` is a secret handed out **exactly once**, by `create_tab`. It
authorizes the host-only actions: editing items, changing tax/tip/extras,
confirming payments, deleting the tab.

- Keep it for the rest of the conversation and pass it on every host call.
- Tell the user it exists and that it's worth saving — if this conversation
  ends and they need to edit the tab from a new chat, that token is the only
  way back in.
- The host's own browser stores its own copy when they create a tab on the web,
  so a tab created *in the browser* can't be host-edited through these tools
  unless the user digs the token out of the site's local storage.

Anyone with just the `tabId` can read the tab and claim items. That's
deliberate — it's the shared link.

## Things that will bite you

**Items freeze once anyone marks themselves paid.** Editing them would change
what an already-paid person owes. `add_items` / `update_item` / `remove_item`
start failing with a clear message. If the user genuinely needs to change
things, someone has to un-mark themselves paid first (`mark_paid` with
`paid: false`).

**One tab per bill.** Don't create a second tab because a detail changed —
`update_tab` and the item tools change anything on an existing one, and a
stale tab in someone's chat history is a real way to collect the wrong amount.

**Check `get_tab` before reporting totals.** Other people are editing the same
tab from their phones while you work; anything you computed a few turns ago may
be stale.

## Tool reference

| Tool | Host token? | What it does |
|---|---|---|
| `create_tab` | — | New tab, optionally with items/tax/tip/extras |
| `get_tab` | no | Full state + who owes what, computed |
| `get_share_link` | no | The URL whose page shows the join QR |
| `update_tab` | yes | Merchant, currency, host Venmo, tax, tip, `tipPercent`, extras |
| `delete_tab` | yes | Permanent |
| `add_items` | yes | Append line items |
| `update_item` / `remove_item` | yes | Fix or drop one item |
| `clear_items` | yes | Wipe all items to re-enter the receipt |
| `add_people` | no | Add participants by name |
| `update_person` / `remove_person` | yes | Rename/set Venmo, or remove |
| `assign_items` | no | Give someone items at a share of 0–1 |
| `split_evenly` | no | Replace all claims with an even split |
| `get_payment_link` | no | Prefilled Venmo link for what one person owes |
| `mark_paid` | no | Payer says they've paid (freezes items) |
| `confirm_payment` | yes | Host confirms the money arrived |
