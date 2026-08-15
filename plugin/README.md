# SplitDumb plugin

Splits a bill from inside Claude. Bundles two things:

- **`.mcp.json`** — connects to SplitDumb's MCP server (17 tools: create a tab,
  edit anything on it, assign items, track who's paid).
- **`skills/splitdumb`** — teaches Claude the workflow: read the receipt photo
  itself, confirm the items with you, then hand you the tab link so the table
  can scan the QR to join.

## Install

```
/plugin marketplace add jwaldor/split-dumb
/plugin install splitdumb@splitdumb
```

## Use

Send Claude a photo of a receipt:

> Split this between me and 3 friends — I'm @your-venmo.

Claude reads the items off the photo, shows you what it got, creates the tab,
and gives you a link. Open the link and let everyone scan the QR code on it.
Then ask "who owes what?" any time.

**Note the `creatorToken`** Claude reports when it makes a tab. It's the secret
that authorizes host edits (changing tax/tip/extras, confirming payments). Save
it if you might want to edit the tab from a future conversation.

## Pointing at your own deployment

The connector URL is baked into `.mcp.json`. To run against a local server or
your own deploy, edit that file:

```json
{ "mcpServers": { "splitdumb": { "type": "http", "url": "http://localhost:3001/mcp" } } }
```

## Why there's no receipt-scanning tool

The app has OCR, but the connector deliberately doesn't expose it. Claude reads
images natively, so it reads your receipt directly and shows you the extracted
items before writing them to a tab — better than a black-box scan, and it keeps
the app's paid OCR key unreachable from connectors.

## ChatGPT

Same MCP server, no plugin wrapper. Enable
**Settings → Connectors → Advanced → Developer mode**, then add
`https://splitdumb-production.up.railway.app/mcp` with no authentication.
See <https://splitdumb-production.up.railway.app/plugin>.
