import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'

const dbPath = process.env.DATABASE_PATH || './splitdumb.db'

// Make sure the parent dir exists (e.g. a mounted volume like /data).
fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true })

export const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS tabs (
    id            TEXT PRIMARY KEY,
    creator_token TEXT NOT NULL,
    creator_venmo TEXT NOT NULL,
    merchant      TEXT,
    currency      TEXT NOT NULL DEFAULT 'USD',
    tax           REAL NOT NULL DEFAULT 0,
    tip           REAL NOT NULL DEFAULT 0,
    fees          REAL NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS items (
    id       TEXT PRIMARY KEY,
    tab_id   TEXT NOT NULL REFERENCES tabs(id) ON DELETE CASCADE,
    name     TEXT NOT NULL,
    price    REAL NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS participants (
    id         TEXT PRIMARY KEY,
    tab_id     TEXT NOT NULL REFERENCES tabs(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    venmo      TEXT,
    paid       INTEGER NOT NULL DEFAULT 0,
    confirmed  INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS claims (
    id             TEXT PRIMARY KEY,
    tab_id         TEXT NOT NULL REFERENCES tabs(id) ON DELETE CASCADE,
    item_id        TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    share          REAL NOT NULL,
    UNIQUE(item_id, participant_id)
  );

  CREATE INDEX IF NOT EXISTS idx_items_tab ON items(tab_id);
  CREATE INDEX IF NOT EXISTS idx_participants_tab ON participants(tab_id);
  CREATE INDEX IF NOT EXISTS idx_claims_tab ON claims(tab_id);
`)

// ---- migrations ------------------------------------------------------------
// Additive only, guarded by a column check, so an existing volume upgrades in
// place on deploy.

const tabColumns = db.prepare(`PRAGMA table_info(tabs)`).all().map((c) => c.name)

// `fees` = extra costs on top of tax and tip — credit-card surcharges, service
// charges, delivery. Split proportionally, exactly like tax and tip.
if (!tabColumns.includes('fees')) {
  db.exec(`ALTER TABLE tabs ADD COLUMN fees REAL NOT NULL DEFAULT 0`)
}

export const q = {
  insertTab: db.prepare(`
    INSERT INTO tabs (id, creator_token, creator_venmo, merchant, currency, tax, tip, fees, created_at)
    VALUES (@id, @creator_token, @creator_venmo, @merchant, @currency, @tax, @tip, @fees, @created_at)
  `),
  getTab: db.prepare(`SELECT * FROM tabs WHERE id = ?`),
  updateTabExtras: db.prepare(`UPDATE tabs SET tax = @tax, tip = @tip, fees = @fees WHERE id = @id`),
  deleteTab: db.prepare(`DELETE FROM tabs WHERE id = ?`),

  insertItem: db.prepare(`
    INSERT INTO items (id, tab_id, name, price, position)
    VALUES (@id, @tab_id, @name, @price, @position)
  `),
  getItems: db.prepare(`SELECT * FROM items WHERE tab_id = ? ORDER BY position, rowid`),
  getItem: db.prepare(`SELECT * FROM items WHERE id = ? AND tab_id = ?`),
  countItems: db.prepare(`SELECT COUNT(*) AS n FROM items WHERE tab_id = ?`),
  deleteItem: db.prepare(`DELETE FROM items WHERE id = ? AND tab_id = ?`),
  deleteItems: db.prepare(`DELETE FROM items WHERE tab_id = ?`),
  updateItem: db.prepare(`UPDATE items SET name = @name, price = @price WHERE id = @id AND tab_id = @tab_id`),
  setItemPosition: db.prepare(`UPDATE items SET position = @position WHERE id = @id AND tab_id = @tab_id`),
  setMeta: db.prepare(`
    UPDATE tabs SET merchant = @merchant, currency = @currency, creator_venmo = @creator_venmo
    WHERE id = @id
  `),

  insertParticipant: db.prepare(`
    INSERT INTO participants (id, tab_id, name, venmo, paid, confirmed, created_at)
    VALUES (@id, @tab_id, @name, @venmo, 0, 0, @created_at)
  `),
  getParticipants: db.prepare(`SELECT * FROM participants WHERE tab_id = ? ORDER BY created_at`),
  countPaid: db.prepare(`SELECT COUNT(*) AS n FROM participants WHERE tab_id = ? AND paid = 1`),
  getParticipant: db.prepare(`SELECT * FROM participants WHERE id = ? AND tab_id = ?`),
  findParticipantByName: db.prepare(`
    SELECT * FROM participants WHERE tab_id = ? AND name = ? COLLATE NOCASE ORDER BY created_at LIMIT 1
  `),
  updateParticipant: db.prepare(`
    UPDATE participants SET name = @name, venmo = @venmo WHERE id = @id AND tab_id = @tab_id
  `),
  deleteParticipant: db.prepare(`DELETE FROM participants WHERE id = ? AND tab_id = ?`),
  setPaid: db.prepare(`UPDATE participants SET paid = @paid WHERE id = @id AND tab_id = @tab_id`),
  setConfirmed: db.prepare(`UPDATE participants SET confirmed = @confirmed WHERE id = @id AND tab_id = @tab_id`),

  getClaims: db.prepare(`SELECT * FROM claims WHERE tab_id = ?`),
  sumOtherShares: db.prepare(`
    SELECT COALESCE(SUM(share), 0) AS s FROM claims
    WHERE item_id = ? AND participant_id != ?
  `),
  upsertClaim: db.prepare(`
    INSERT INTO claims (id, tab_id, item_id, participant_id, share)
    VALUES (@id, @tab_id, @item_id, @participant_id, @share)
    ON CONFLICT(item_id, participant_id) DO UPDATE SET share = @share
  `),
  deleteClaim: db.prepare(`DELETE FROM claims WHERE item_id = ? AND participant_id = ?`),
}
