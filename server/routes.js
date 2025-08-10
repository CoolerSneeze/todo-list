// Minimal dev API middleware for health check only.
// This keeps changes small and verifies the Vite middleware wiring.

/**
 * Attach API routes to the Vite dev server.
 * @param {import('vite').ViteDevServer} server
 */
export function registerApi(server) {
  const VERBOSE_API = process.env.API_LOGS === '1' || process.env.VITE_API_LOGS === '1';
  // Basic JSON helper
  function sendJson(res, code, obj) {
    res.statusCode = code;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj));
  }

  // Retry wrapper for transient busy/locked errors
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function withRetries(fn, { attempts = 3, baseDelay = 50 } = {}) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (e) {
        const { status } = classifyDbError(e);
        if (status === 503 && i < attempts - 1) {
          const delay = baseDelay * Math.pow(2, i); // 50ms, 100ms, 200ms
          await sleep(delay);
          continue;
        }
        lastErr = e;
        break;
      }
    }
    throw lastErr;
  }
  async function readJson(req) {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (c) => { data += c; });
      req.on('end', () => {
        if (!data) return resolve({});
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
      req.on('error', reject);
    });
  }

  // Normalize DB errors to user-friendly HTTP responses
  function classifyDbError(e) {
    const msg = String(e && e.message ? e.message : e);
    const code = e && e.code ? String(e.code) : '';
    // better-sqlite3 typically uses SQLITE_* codes
    if (code === 'SQLITE_CONSTRAINT' || /constraint/i.test(msg)) {
      return { status: 409, message: 'Constraint violation' };
    }
    if (code === 'SQLITE_BUSY' || /database is locked|busy/i.test(msg)) {
      return { status: 503, message: 'Database busy, please retry' };
    }
    if (/not found/i.test(msg)) {
      return { status: 404, message: msg };
    }
    return { status: 500, message: msg };
  }

  server.middlewares.use((req, res, next) => {
    try {
      const url = req.url || '';
      const u = new URL('http://x' + url);
      const pathname = u.pathname;
      if (VERBOSE_API && url.startsWith('/api')) {
        console.log('[api] request:', req.method, url);
      }

      // Only intercept our health endpoint; pass everything else through
      if (
        req.method === 'GET' && (
          url === '/api/health' || url.startsWith('/api/health?') ||
          url === '/api/health.txt' || url.startsWith('/api/health.txt?')
        )
      ) {
        res.setHeader('X-API', 'health');
        return sendJson(res, 200, { ok: true, ts: Date.now() });
      }

      // Settings endpoints (SQLite-backed)
      if (url === '/api/settings' && req.method === 'GET') {
        (async () => {
          try {
            const mod = await import('./db.js');
            const row = mod.getSettingsRow();
            return sendJson(res, 200, { ok: true, settings: row });
          } catch (e) {
            console.error('[api] GET /api/settings error:', e);
            const { status, message } = classifyDbError(e);
            return sendJson(res, status, { ok: false, error: message });
          }
        })();
        return;
      }

      if (url === '/api/todos/positions' && req.method === 'PATCH') {
        (async () => {
          try {
            const body = await readJson(req);
            if (!Array.isArray(body)) return sendJson(res, 400, { ok: false, error: 'Body must be an array' });
            // Shallow validation before hitting DB
            if (body.length === 0) return sendJson(res, 400, { ok: false, error: 'Array must not be empty' });
            const ids = new Set();
            const positions = new Set();
            for (const row of body) {
              if (!row || typeof row !== 'object') return sendJson(res, 400, { ok: false, error: 'Each item must be an object' });
              const id = Number(row.id);
              const pos = Number(row.position);
              const pid = row.parentId == null ? null : Number(row.parentId);
              if (!Number.isFinite(id) || !Number.isFinite(pos)) {
                return sendJson(res, 400, { ok: false, error: 'id and position must be numbers' });
              }
              if (pid !== null && !Number.isFinite(pid)) {
                return sendJson(res, 400, { ok: false, error: 'parentId must be null or a number' });
              }
              if (ids.has(id)) {
                return sendJson(res, 400, { ok: false, error: `Duplicate id in payload: ${id}` });
              }
              if (positions.has(pos)) {
                return sendJson(res, 400, { ok: false, error: `Duplicate position in payload: ${pos}` });
              }
              ids.add(id);
              positions.add(pos);
            }
            // Enforce: the top item (position 1) cannot be indented
            const top = body.find(r => Number(r.position) === 1);
            if (top && top.parentId != null) {
              return sendJson(res, 400, { ok: false, error: 'Cannot indent the first item in the list' });
            }
            const mod = await import('./db.js');
            const result = await withRetries(() => Promise.resolve(mod.updateTodoPositions(body)));
            return sendJson(res, 200, { ok: true, ...result });
          } catch (e) {
            console.error('[api] PATCH /api/todos/positions error:', e);
            const { status, message } = classifyDbError(e);
            return sendJson(res, status, { ok: false, error: message });
          }
        })();
        return;
      }

      if (url === '/api/settings/title' && req.method === 'PATCH') {
        (async () => {
          try {
            const body = await readJson(req);
            const title = String(body?.title ?? '');
            const mod = await import('./db.js');
            const row = mod.setTitle(title);
            return sendJson(res, 200, { ok: true, settings: row });
          } catch (e) {
            console.error('[api] PATCH /api/settings/title error:', e);
            const { status, message } = classifyDbError(e);
            return sendJson(res, status, { ok: false, error: message });
          }
        })();
        return;
      }

      if (url === '/api/settings/dark-mode' && req.method === 'PATCH') {
        (async () => {
          try {
            const body = await readJson(req);
            const mod = await import('./db.js');
            const row = mod.setDarkMode(!!body?.dark_mode);
            return sendJson(res, 200, { ok: true, settings: row });
          } catch (e) {
            console.error('[api] PATCH /api/settings/dark-mode error:', e);
            const { status, message } = classifyDbError(e);
            return sendJson(res, status, { ok: false, error: message });
          }
        })();
        return;
      }

      // Current list
      if (url === '/api/settings/current-list' && req.method === 'GET') {
        (async () => {
          try {
            const mod = await import('./db.js');
            const id = mod.getCurrentListId();
            return sendJson(res, 200, { ok: true, id });
          } catch (e) {
            console.error('[api] GET /api/settings/current-list error:', e);
            const { status, message } = classifyDbError(e);
            return sendJson(res, status, { ok: false, error: message });
          }
        })();
        return;
      }

      if (url === '/api/settings/current-list' && req.method === 'PATCH') {
        (async () => {
          try {
            const body = await readJson(req);
            const mod = await import('./db.js');
            const out = mod.setCurrentList(Number(body?.id));
            return sendJson(res, 200, { ok: true, id: out?.id ?? body?.id });
          } catch (e) {
            console.error('[api] PATCH /api/settings/current-list error:', e);
            const { status, message } = classifyDbError(e);
            return sendJson(res, status, { ok: false, error: message });
          }
        })();
        return;
      }

      // Lists CRUD
      if (url === '/api/lists' && req.method === 'GET') {
        (async () => {
          try {
            const mod = await import('./db.js');
            const rows = mod.listLists();
            return sendJson(res, 200, { ok: true, lists: rows });
          } catch (e) {
            console.error('[api] GET /api/lists error:', e);
            const { status, message } = classifyDbError(e);
            return sendJson(res, status, { ok: false, error: message });
          }
        })();
        return;
      }

      if (url === '/api/lists' && req.method === 'POST') {
        (async () => {
          try {
            const body = await readJson(req);
            const mod = await import('./db.js');
            const row = await withRetries(() => Promise.resolve(mod.createList(body?.name || 'New List')));
            return sendJson(res, 200, { ok: true, list: row });
          } catch (e) {
            console.error('[api] POST /api/lists error:', e);
            const { status, message } = classifyDbError(e);
            return sendJson(res, status, { ok: false, error: message });
          }
        })();
        return;
      }

      if (url.match(/^\/api\/lists\/(\d+)$/) && req.method === 'PATCH') {
        (async () => {
          try {
            const m = url.match(/^\/api\/lists\/(\d+)/);
            const id = m ? Number(m[1]) : NaN;
            const body = await readJson(req);
            const mod = await import('./db.js');
            const row = await withRetries(() => Promise.resolve(mod.renameList(id, body?.name || '')));
            return sendJson(res, 200, { ok: true, list: row });
          } catch (e) {
            console.error('[api] PATCH /api/lists/:id error:', e);
            const { status, message } = classifyDbError(e);
            return sendJson(res, status, { ok: false, error: message });
          }
        })();
        return;
      }

      if (url.match(/^\/api\/lists\/(\d+)$/) && req.method === 'DELETE') {
        (async () => {
          try {
            const m = url.match(/^\/api\/lists\/(\d+)/);
            const id = m ? Number(m[1]) : NaN;
            const mod = await import('./db.js');
            const out = await withRetries(() => Promise.resolve(mod.deleteList(id)));
            return sendJson(res, 200, { ok: true, ...out });
          } catch (e) {
            console.error('[api] DELETE /api/lists/:id error:', e);
            const { status, message } = classifyDbError(e);
            return sendJson(res, status, { ok: false, error: message });
          }
        })();
        return;
      }

      // Todos read-only
      if (url.startsWith('/api/todos') && req.method === 'GET') {
        (async () => {
          try {
            const u = new URL('http://x' + url); // dummy host for parsing
            const listIdStr = u.searchParams.get('list_id');
            const mod = await import('./db.js');
            const listId = listIdStr ? Number(listIdStr) : mod.getCurrentListId();
            if (!listId) return sendJson(res, 400, { ok: false, error: 'missing list_id' });
            const rows = mod.listTodosForList(listId);
            return sendJson(res, 200, { ok: true, todos: rows });
          } catch (e) {
            console.error('[api] GET /api/todos error:', e);
            const { status, message } = classifyDbError(e);
            return sendJson(res, status, { ok: false, error: message });
          }
        })();
        return;
      }

      if (url === '/api/todos' && req.method === 'POST') {
        (async () => {
          try {
            const body = await readJson(req);
            const mod = await import('./db.js');
            const todo = await withRetries(() => Promise.resolve(mod.createTodo({
              text: body?.text ?? '',
              completed: !!body?.completed,
              isEmpty: body?.isEmpty,
              parentId: body?.parentId ?? null,
              isIndented: !!body?.isIndented,
              position: body?.position,
              listId: body?.listId
            })));
            return sendJson(res, 200, { ok: true, todo });
          } catch (e) {
            console.error('[api] POST /api/todos error:', e);
            const { status, message } = classifyDbError(e);
            return sendJson(res, status, { ok: false, error: message });
          }
        })();
        return;
      }

      if (url.match(/^\/api\/todos\/(\d+)$/) && req.method === 'PATCH') {
        (async () => {
          try {
            const m = url.match(/^\/api\/todos\/(\d+)/);
            const id = m ? Number(m[1]) : NaN;
            const body = await readJson(req);
            const mod = await import('./db.js');
            const updated = await withRetries(() => Promise.resolve(mod.updateTodo(id, body || {})));
            return sendJson(res, 200, { ok: true, todo: updated });
          } catch (e) {
            console.error('[api] PATCH /api/todos/:id error:', e);
            const { status, message } = classifyDbError(e);
            return sendJson(res, status, { ok: false, error: message });
          }
        })();
        return;
      }

      if (pathname.match(/^\/api\/todos\/(\d+)$/) && req.method === 'DELETE') {
        (async () => {
          try {
            const m = pathname.match(/^\/api\/todos\/(\d+)/);
            const id = m ? Number(m[1]) : NaN;
            const cascadeParam = u.searchParams.get('cascade');
            const cascade = cascadeParam == null ? true : cascadeParam !== '0';
            const mod = await import('./db.js');
            const out = await withRetries(() => Promise.resolve(mod.deleteTodo(id, { cascade })));
            return sendJson(res, 200, { ok: true, ...out });
          } catch (e) {
            console.error('[api] DELETE /api/todos/:id error:', e);
            const { status, message } = classifyDbError(e);
            return sendJson(res, status, { ok: false, error: message });
          }
        })();
        return;
      }
      return next();
    } catch (e) {
      console.error('[api] health middleware error:', e);
      return sendJson(res, 500, { ok: false, error: String(e) });
    }
  });

  console.log('[api] Health middleware registered');
}
