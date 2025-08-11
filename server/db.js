// Minimal SQLite setup for settings only
// Uses better-sqlite3 synchronously; safe for Vite dev middleware.

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

let db;

export function getDb() {
  if (db) return db;
  const dataDir = path.resolve(process.cwd(), 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'todo.db');
  db = new Database(dbPath);
  // Pragmas for durability and concurrency
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');

  // Schema: settings and lists (settings.id constrained to 1)
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK(id=1),
      title TEXT NOT NULL DEFAULT 'My Todo List',
      dark_mode INTEGER NOT NULL DEFAULT 0,
      current_list_id INTEGER NULL
        REFERENCES lists(id) ON UPDATE CASCADE ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS lists (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_lists_updated_at ON lists(updated_at);

    CREATE TABLE IF NOT EXISTS todos (
      id INTEGER PRIMARY KEY,
      text TEXT NOT NULL DEFAULT '',
      completed INTEGER NOT NULL DEFAULT 0,
      is_empty INTEGER NOT NULL DEFAULT 1,
      parent_id INTEGER NULL
        REFERENCES todos(id) ON UPDATE CASCADE ON DELETE SET NULL,
      is_indented INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL,
      list_id INTEGER NOT NULL
        REFERENCES lists(id) ON UPDATE CASCADE ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_todos_parent ON todos(parent_id);
  `);

  // Ensure critical indexes exist (even for fresh DBs where migrations may not run)
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_todos_list_pos ON todos(list_id, position);`);
  } catch {}

  // --- Lightweight migrations for existing databases ---
  const hasColumn = (table, name) => {
    try {
      const rows = db.prepare(`PRAGMA table_info(${table})`).all();
      return rows.some((r) => r.name === name);
    } catch {
      return false;
    }
  };

  // settings.current_list_id
  if (!hasColumn('settings', 'current_list_id')) {
    db.exec(`ALTER TABLE settings ADD COLUMN current_list_id INTEGER NULL`);
  }

  // todos.list_id
  if (!hasColumn('todos', 'list_id')) {
    db.exec(`ALTER TABLE todos ADD COLUMN list_id INTEGER`);
    // Index may fail if column absent previously; create (or recreate) now
    db.exec(`CREATE INDEX IF NOT EXISTS idx_todos_list_pos ON todos(list_id, position);`);
  }

  // Ensure lists table exists (older DBs may lack it)
  db.exec(`
    CREATE TABLE IF NOT EXISTS lists (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_lists_updated_at ON lists(updated_at);
  `);

  // Seed row if missing
  const row = db.prepare('SELECT COUNT(1) as c FROM settings WHERE id=1').get();
  if (!row || row.c === 0) {
    db.prepare('INSERT INTO settings (id, title, dark_mode, current_list_id) VALUES (1, ?, 0, NULL)').run('My Todo List');
  }

  // Ensure at least one list exists and settings.current_list_id is set
  const listCount = db.prepare('SELECT COUNT(1) as c FROM lists').get().c;
  if (listCount === 0) {
    const now = Date.now();
    const info = db.prepare('INSERT INTO lists (name, created_at, updated_at) VALUES (?, ?, ?)').run('My Todo List', now, now);
    const newId = info.lastInsertRowid;
    db.prepare('UPDATE settings SET current_list_id=? WHERE id=1').run(newId);
  } else {
    const cur = db.prepare('SELECT current_list_id FROM settings WHERE id=1').get();
    if (!cur || cur.current_list_id == null) {
      const any = db.prepare('SELECT id FROM lists ORDER BY id LIMIT 1').get();
      if (any) db.prepare('UPDATE settings SET current_list_id=? WHERE id=1').run(any.id);
    }
  }

  // Backfill todos.list_id for legacy rows where it is NULL
  try {
    const curList = db.prepare('SELECT current_list_id as id FROM settings WHERE id=1').get()?.id;
    if (curList != null) {
      db.prepare('UPDATE todos SET list_id=? WHERE list_id IS NULL').run(curList);
    }
  } catch {}

  // Lightweight startup integrity + config checks (dev-friendly: log only)
  try {
    const jm = db.pragma('journal_mode', { simple: true });
    const fk = db.pragma('foreign_keys', { simple: true });
    const bt = db.pragma('busy_timeout', { simple: true });
    const sync = db.pragma('synchronous', { simple: true });
    const ic = db.prepare('PRAGMA integrity_check').get();
    const integrity = (ic && (ic.integrity_check || ic[Object.keys(ic)[0]])) || 'unknown';
    const ok = String(integrity).toLowerCase() === 'ok';
    console.log('[db] PRAGMAs:', {
      journal_mode: jm,
      foreign_keys: fk,
      busy_timeout: bt,
      synchronous: sync
    });
    if (!ok) {
      console.warn('[db] integrity_check did not return OK:', integrity);
    }
  } catch (e) {
    console.warn('[db] startup integrity/config checks failed:', e?.message || e);
  }

  return db;
}

// Lightweight prepared statement cache keyed by SQL string
const __stmtCache = new Map();
function stmt(sql) {
  let s = __stmtCache.get(sql);
  if (!s) {
    s = getDb().prepare(sql);
    __stmtCache.set(sql, s);
  }
  return s;
}

// Simple reusable transaction helper. Returns a function that executes `fn` inside a transaction.
// Usage: const doThing = withTxn((d, arg1, arg2) => { /* use d */ }); doThing(a1, a2)
export function withTxn(fn) {
  const d = getDb();
  const tx = d.transaction((...args) => fn(d, ...args));
  return (...args) => tx(...args);
}

// Re-number positions within a list to be 1..N in current order
function compactPositionsTx(d, listId) {
  const rows = stmt('SELECT id FROM todos WHERE list_id=? ORDER BY position ASC, id ASC').all(listId);
  const upd = stmt('UPDATE todos SET position=? WHERE id=?');
  let pos = 1;
  for (const r of rows) upd.run(pos++, r.id);
}

// Delete a todo. If cascade=true, delete all descendants as well. Otherwise, lift descendants to root.
export function deleteTodo(id, opts = { cascade: true }) {
  const d = getDb();
  const tx = d.transaction((tid, cascadeFlag) => {
    const target = d.prepare('SELECT id, list_id FROM todos WHERE id=?').get(tid);
    if (!target) throw new Error('Todo not found');
    const listId = target.list_id;

    // Collect descendants via recursive CTE
    const cteSql = `WITH RECURSIVE cte(id) AS (
      SELECT ?
      UNION ALL
      SELECT t.id FROM todos t JOIN cte ON t.parent_id = cte.id
    ) SELECT id FROM cte WHERE id != ?`;
    const descendants = d.prepare(cteSql).all(tid, tid).map(r => r.id);

    let deletedIds = [];
    if (cascadeFlag) {
      const delCteSql = `WITH RECURSIVE cte(id) AS (
        SELECT ?
        UNION ALL
        SELECT t.id FROM todos t JOIN cte ON t.parent_id = cte.id
      ) DELETE FROM todos WHERE id IN (SELECT id FROM cte)`;
      d.prepare(delCteSql).run(tid);
      deletedIds = [tid, ...descendants];
    } else {
      if (descendants.length) {
        const lift = d.prepare('UPDATE todos SET parent_id=NULL, is_indented=0 WHERE id=?');
        for (const did of descendants) lift.run(did);
      }
      d.prepare('DELETE FROM todos WHERE id=?').run(tid);
      deletedIds = [tid];
    }

    compactPositionsTx(d, listId);
    return { success: true, deletedIds, cascaded: !!cascadeFlag, listId, liftedIds: cascadeFlag ? [] : descendants };
  });
  const cascadeFlag = opts && Object.prototype.hasOwnProperty.call(opts, 'cascade') ? !!opts.cascade : true;
  return tx(Number(id), cascadeFlag);
}

// Bulk update positions/parent/indent for multiple todos atomically
export function updateTodoPositions(updates) {
  const d = getDb();
  if (!Array.isArray(updates) || updates.length === 0) return [];
  const run = withTxn((db, rows) => {
    // Determine list id from first todo; ensure all are in same list
    const first = stmt('SELECT id, list_id FROM todos WHERE id=?').get(rows[0].id);
    if (!first) throw new Error('First todo not found');
    const listId = first.list_id;
    const selMeta = stmt('SELECT id, list_id, parent_id FROM todos WHERE id=?');

    // Build proposed parent mapping and validate basic constraints
    const proposed = new Map(); // id -> { position, parentId }
    for (const r of rows) {
      const id = Number(r.id);
      const pos = Number(r.position);
      if (!Number.isFinite(id) || !Number.isFinite(pos)) throw new Error('Invalid id/position');
      const meta = selMeta.get(id);
      if (!meta) throw new Error(`Todo ${id} not found`);
      if (meta.list_id !== listId) throw new Error('All updates must be within the same list');
      const pid = r.parentId == null ? null : Number(r.parentId);
      if (pid === id) throw new Error('A todo cannot be its own parent');
      proposed.set(id, { position: pos, parentId: pid });
    }

    // Helper to get current or proposed parent
    const getParent = (id) => {
      const p = proposed.get(id);
      if (p) return p.parentId;
      const rec = selMeta.get(id);
      return rec ? rec.parent_id : null;
    };

    // Validate that proposed parent exists in the same list and no cycles are created
    for (const [id, { parentId: pid }] of proposed) {
      if (pid == null) continue;
      const meta = selMeta.get(pid);
      if (!meta) throw new Error(`Parent ${pid} not found`);
      if (meta.list_id !== listId) throw new Error('Parent must be in the same list');
      // Cycle check: follow parents until null or cycle
      const seen = new Set([id]);
      let cur = pid;
      while (cur != null) {
        if (seen.has(cur)) throw new Error('Parent cycle detected');
        seen.add(cur);
        cur = getParent(cur);
      }
    }

    // Perform updates; coerce is_indented = parent_id != NULL
    const updStmt = stmt('UPDATE todos SET position=?, parent_id=?, is_indented=? WHERE id=?');
    for (const [id, { position, parentId }] of proposed) {
      const ind = parentId == null ? 0 : 1;
      updStmt.run(position, parentId, ind, id);
    }
    compactPositionsTx(db, listId);
    return { success: true, count: rows.length, listId };
  });
  return run(updates);
}

// Helpers for settings
export function getSettingsRow() {
  const d = getDb();
  return stmt('SELECT title, dark_mode, current_list_id FROM settings WHERE id=1').get();
}

export function setTitle(title) {
  const d = getDb();
  const tx = d.transaction((t) => {
    stmt('UPDATE settings SET title=? WHERE id=1').run(String(t));
    return stmt('SELECT title, dark_mode, current_list_id FROM settings WHERE id=1').get();
  });
  return tx(title);
}

export function setDarkMode(flag) {
  const d = getDb();
  const v = flag ? 1 : 0;
  const tx = d.transaction((val) => {
    stmt('UPDATE settings SET dark_mode=? WHERE id=1').run(val);
    return stmt('SELECT title, dark_mode, current_list_id FROM settings WHERE id=1').get();
  });
  return tx(v);
}

// Convenience wrapper used by some callers
export function getSettings() {
  return getSettingsRow();
}

// Current list
export function getCurrentListId() {
  const d = getDb();
  const row = stmt('SELECT current_list_id as id FROM settings WHERE id=1').get();
  return row?.id ?? null;
}

export function setCurrentList(id) {
  const d = getDb();
  const tx = d.transaction((lid) => {
    const exists = stmt('SELECT 1 FROM lists WHERE id=?').get(lid);
    if (!exists) throw new Error('List not found');
    stmt('UPDATE settings SET current_list_id=? WHERE id=1').run(lid);
    return stmt('SELECT current_list_id as id FROM settings WHERE id=1').get();
  });
  return tx(id);
}

// === Dev-only utilities ===
// Intentionally perform a write inside a transaction and throw to verify rollback works.
/* devTxnTest removed after verification */

// Todos read-only for now
export function listTodosForList(listId) {
  const d = getDb();
  const sql = `SELECT id, text, completed, is_empty as isEmpty, parent_id as parentId, is_indented as isIndented, position, list_id as listId
               FROM todos WHERE list_id=? ORDER BY position ASC`;
  return stmt(sql).all(listId);
}

export function createTodo(input) {
  const d = getDb();
  const tx = d.transaction((payload) => {
    // Resolve list id
    let listId = Number(payload?.listId);
    if (!listId) {
      const s = getSettings();
      listId = Number(s.current_list_id) || 1;
    }
    const text = (payload?.text ?? '').toString();
    const completed = payload?.completed ? 1 : 0;
    const isEmpty = payload?.isEmpty ? 1 : (text.trim() === '' ? 1 : 0);
    const parentId = payload?.parentId != null ? Number(payload.parentId) : null;
    // Validate parent and coerce indentation rules
    if (parentId != null) {
      const p = stmt('SELECT id, list_id FROM todos WHERE id=?').get(parentId);
      if (!p) throw new Error('Parent todo not found');
      if (Number(p.list_id) !== listId) throw new Error('Parent must be in the same list');
    }
    // isIndented mirrors presence of parentId
    const isIndented = parentId != null ? 1 : 0;

    // Determine position if not supplied
    let position = Number(payload?.position);
    if (!position || position <= 0) {
      const row = stmt('SELECT COALESCE(MAX(position), 0) as maxPos FROM todos WHERE list_id=?').get(listId);
      position = Number(row.maxPos) + 1;
    }

    // Disallow indenting the first item
    if (parentId != null && position === 1) {
      throw new Error('Cannot indent the first item in the list');
    }

    const ins = stmt(`
      INSERT INTO todos (text, completed, is_empty, parent_id, is_indented, position, list_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const info = ins.run(text, completed, isEmpty, parentId, isIndented, position, listId);
    const id = Number(info.lastInsertRowid);
    const sel = stmt(`SELECT id, text, completed, is_empty as isEmpty, parent_id as parentId, is_indented as isIndented, position, list_id as listId FROM todos WHERE id=?`).get(id);
    return sel;
  });
  return tx(input || {});
}

// Update a single todo (id), only allowing specific fields. list_id remains unchanged.
export function updateTodo(id, patch) {
  const d = getDb();
  const tx = d.transaction((tid, p) => {
    const row = stmt('SELECT id, list_id, parent_id as parentId, position FROM todos WHERE id=?').get(tid);
    if (!row) throw new Error('Todo not found');
    // Determine target parent and position for validation
    const targetParentId = (Object.prototype.hasOwnProperty.call(p, 'parentId') ? (p.parentId == null ? null : Number(p.parentId)) : row.parentId);
    const targetPosition = (Object.prototype.hasOwnProperty.call(p, 'position') ? Number(p.position) : Number(row.position));
    // Parent must exist and be in the same list
    if (targetParentId != null) {
      if (Number(targetParentId) === Number(tid)) throw new Error('Cannot set parent to self');
      const pr = stmt('SELECT id, list_id, parent_id FROM todos WHERE id=?').get(targetParentId);
      if (!pr) throw new Error('Parent todo not found');
      if (Number(pr.list_id) !== Number(row.list_id)) throw new Error('Parent must be in the same list');
      // Cycle guard: walk up ancestor chain
      let cur = pr;
      while (cur && cur.parent_id != null) {
        if (Number(cur.parent_id) === Number(tid)) {
          throw new Error('Cannot create cyclic parent relationship');
        }
        cur = stmt('SELECT id, parent_id FROM todos WHERE id=?').get(cur.parent_id);
      }
    }
    // Disallow indenting first item
    if (targetParentId != null && targetPosition === 1) {
      throw new Error('Cannot indent the first item in the list');
    }
    // Build dynamic set clause safely for allowed fields
    const allowed = {
      text: (v) => String(v ?? ''),
      completed: (v) => (v ? 1 : 0),
      isEmpty: (v) => (v ? 1 : 0),
      parentId: (v) => (v == null ? null : Number(v)),
      // Coerce isIndented to mirror parentId after validation
      isIndented: () => (targetParentId != null ? 1 : 0),
      position: (v) => (v == null ? undefined : Number(v))
    };
    const sets = [];
    const vals = [];
    if (Object.prototype.hasOwnProperty.call(p, 'text')) { sets.push('text=?'); vals.push(allowed.text(p.text)); }
    if (Object.prototype.hasOwnProperty.call(p, 'completed')) { sets.push('completed=?'); vals.push(allowed.completed(p.completed)); }
    if (Object.prototype.hasOwnProperty.call(p, 'isEmpty')) { sets.push('is_empty=?'); vals.push(allowed.isEmpty(p.isEmpty)); }
    if (Object.prototype.hasOwnProperty.call(p, 'parentId')) { sets.push('parent_id=?'); vals.push(allowed.parentId(p.parentId)); }
    // Always keep is_indented consistent with parent_id if either parentId or isIndented is present
    if (Object.prototype.hasOwnProperty.call(p, 'parentId') || Object.prototype.hasOwnProperty.call(p, 'isIndented')) {
      sets.push('is_indented=?');
      vals.push(allowed.isIndented());
    }
    if (Object.prototype.hasOwnProperty.call(p, 'position')) { const v = allowed.position(p.position); if (v !== undefined) { sets.push('position=?'); vals.push(v); } }
    if (!sets.length) {
      // nothing to update, return current row
      return stmt(`SELECT id, text, completed, is_empty as isEmpty, parent_id as parentId, is_indented as isIndented, position, list_id as listId FROM todos WHERE id=?`).get(tid);
    }
    const sql = `UPDATE todos SET ${sets.join(', ')} WHERE id=?`;
    vals.push(tid);
    d.prepare(sql).run(...vals);
    // Return updated row
    return d.prepare(`SELECT id, text, completed, is_empty as isEmpty, parent_id as parentId, is_indented as isIndented, position, list_id as listId FROM todos WHERE id=?`).get(tid);
  });
  return tx(Number(id), patch || {});
}

// Lists CRUD
export function listLists() {
  const d = getDb();
  return d.prepare('SELECT id, name, created_at, updated_at FROM lists ORDER BY id').all();
}

export function createList(name) {
  const d = getDb();
  const now = Date.now();
  const tx = d.transaction((n) => {
    const info = d.prepare('INSERT INTO lists (name, created_at, updated_at) VALUES (?, ?, ?)').run(String(n || 'New List'), now, now);
    const id = info.lastInsertRowid;
    d.prepare('UPDATE settings SET current_list_id=? WHERE id=1').run(id);
    return d.prepare('SELECT id, name, created_at, updated_at FROM lists WHERE id=?').get(id);
  });
  return tx(name);
}

export function renameList(id, name) {
  const d = getDb();
  const tx = d.transaction((lid, n) => {
    const exists = d.prepare('SELECT 1 FROM lists WHERE id=?').get(lid);
    if (!exists) throw new Error('List not found');
    d.prepare('UPDATE lists SET name=?, updated_at=? WHERE id=?').run(String(n), Date.now(), lid);
    return d.prepare('SELECT id, name, created_at, updated_at FROM lists WHERE id=?').get(lid);
  });
  return tx(id, name);
}

export function deleteList(id) {
  const d = getDb();
  const tx = d.transaction((lid) => {
    // Delete list
    const info = d.prepare('DELETE FROM lists WHERE id=?').run(lid);
    if (info.changes === 0) throw new Error('List not found');
    // If current list was deleted, pick another
    const cur = d.prepare('SELECT current_list_id FROM settings WHERE id=1').get();
    if (cur?.current_list_id === lid) {
      const any = d.prepare('SELECT id FROM lists ORDER BY id LIMIT 1').get();
      const nextId = any ? any.id : null;
      d.prepare('UPDATE settings SET current_list_id=? WHERE id=1').run(nextId);
    }
    return { success: true };
  });
  return tx(id);
}
