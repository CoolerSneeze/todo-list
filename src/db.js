/**
 * Simple in-memory storage for todos with lightweight localStorage persistence.
 * No server required. Safe first step toward persistence.
 */

// Gated client logging to keep the console quiet by default in dev
// Vite guarantees import.meta.env at build/runtime
const VERBOSE_CLIENT = import.meta.env?.VITE_CLIENT_LOGS === '1';
const WARN_FALLBACK = import.meta.env?.VITE_FALLBACK_LOGS === '1';
const clog = (...args) => { if (VERBOSE_CLIENT) console.log(...args); };
const cwarn = (...args) => { if (WARN_FALLBACK) console.warn(...args); };

const LS_KEYS = {
  todos: 'todo_app.todos.v2',
  settings: 'todo_app.settings.v1',
  lists: 'todo_app.lists.v1',
  currentListId: 'todo_app.current_list_id.v1'
};

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

let todos = loadJSON(LS_KEYS.todos, []);
let settings = loadJSON(LS_KEYS.settings, {
  title: 'My Todo List',
  dark_mode: false
});

// Lists and current list
let lists = loadJSON(LS_KEYS.lists, [
  { id: 1, name: 'My Todo List', created_at: Date.now(), updated_at: Date.now() }
]);
let currentListId = (() => {
  const stored = loadJSON(LS_KEYS.currentListId, null);
  const id = stored ?? (lists[0]?.id ?? 1);
  // ensure it exists
  if (!lists.some(l => l.id === id)) {
    return lists[0]?.id ?? 1;
  }
  return id;
})();

function saveListsState() {
  saveJSON(LS_KEYS.lists, lists);
  saveJSON(LS_KEYS.currentListId, currentListId);
}

// One-time migration: assign listId to legacy todos missing it
if (Array.isArray(todos) && todos.length && !todos[0].hasOwnProperty('listId')) {
  todos = todos.map(t => ({ ...t, listId: currentListId }));
  saveJSON(LS_KEYS.todos, todos);
}

// Derive nextId from loaded todos to avoid collisions
let nextId = (todos.reduce((m, t) => Math.max(m, t.id || 0), 0) || 0) + 1;

function saveTodos() {
  saveJSON(LS_KEYS.todos, todos);
}

function todosOf(listId) {
  return todos.filter(t => t.listId === listId);
}

function nextPositionFor(listId) {
  const listTodos = todosOf(listId);
  const maxPos = listTodos.reduce((m, t) => Math.max(m, t.position || 0), 0);
  return maxPos + 1;
}

function compactPositions(listId) {
  const listTodos = todosOf(listId)
    .sort((a, b) => (a.position || 0) - (b.position || 0));
  let idx = 1;
  for (const t of listTodos) {
    t.position = idx++;
  }
}

const db = {
  // Settings operations
  getSettings: async () => {
    try {
      const r = await fetch('/api/settings');
      if (!r.ok) throw new Error('settings fetch failed');
      const data = await r.json();
      const s = data?.settings ?? {};
      // normalize
      const normalized = { title: s.title ?? settings.title, dark_mode: !!s.dark_mode };
      // keep LS in sync for now
      settings = normalized;
      saveJSON(LS_KEYS.settings, settings);
      clog('Retrieved settings (API-backed):', settings);
      return normalized;
    } catch (e) {
      cwarn('Falling back to LS settings due to API error:', e);
      clog('Retrieved settings (LS-backed):', settings);
      return { ...settings };
    }
  },
  
  updateTitle: async (title) => {
    try {
      const r = await fetch('/api/settings/title', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title })
      });
      if (!r.ok) throw new Error('update title failed');
      const data = await r.json();
      const s = data?.settings ?? {};
      settings.title = s.title ?? title;
      saveJSON(LS_KEYS.settings, settings);
      clog('Updated title (API-backed):', settings.title);
      return { success: true, title: settings.title };
    } catch (e) {
      cwarn('Title API failed; updating LS as fallback:', e);
      settings.title = title;
      saveJSON(LS_KEYS.settings, settings);
      clog('Updated title (LS-backed):', title);
      return { success: true, title };
    }
  },
  
  updateDarkMode: async (isDarkMode) => {
    try {
      const r = await fetch('/api/settings/dark-mode', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dark_mode: !!isDarkMode })
      });
      if (!r.ok) throw new Error('update dark mode failed');
      const data = await r.json();
      const s = data?.settings ?? {};
      settings.dark_mode = !!s.dark_mode;
      saveJSON(LS_KEYS.settings, settings);
      clog('Updated dark mode (API-backed):', settings.dark_mode);
      return { success: true, dark_mode: settings.dark_mode };
    } catch (e) {
      cwarn('Dark mode API failed; updating LS as fallback:', e);
      settings.dark_mode = !!isDarkMode;
      saveJSON(LS_KEYS.settings, settings);
      clog('Updated dark mode (LS-backed):', settings.dark_mode);
      return { success: true, dark_mode: settings.dark_mode };
    }
  },
  
  // List operations (local-only)
  getLists: async () => {
    try {
      const r = await fetch('/api/lists');
      if (!r.ok) throw new Error('lists fetch failed');
      const data = await r.json();
      const rows = Array.isArray(data?.lists) ? data.lists : [];
      lists = rows.map(x => ({ ...x }));
      saveListsState();
      return lists.map(l => ({ ...l }));
    } catch (e) {
      cwarn('Falling back to LS lists due to API error:', e);
      return lists.map(l => ({ ...l }));
    }
  },
  getCurrentListId: async () => {
    try {
      const r = await fetch('/api/settings/current-list');
      if (!r.ok) throw new Error('current list fetch failed');
      const data = await r.json();
      const id = data?.id ?? currentListId;
      if (typeof id === 'number') currentListId = id;
      saveListsState();
      return currentListId;
    } catch (e) {
      cwarn('Falling back to LS currentListId due to API error:', e);
      return currentListId;
    }
  },
  setCurrentListId: async (id) => {
    try {
      const r = await fetch('/api/settings/current-list', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      if (!r.ok) throw new Error('set current list failed');
      const data = await r.json();
      const newId = data?.id ?? id;
      currentListId = newId;
      saveListsState();
      return { success: true, currentListId };
    } catch (e) {
      cwarn('Current list API failed; updating LS as fallback:', e);
      if (!lists.some(l => l.id === id)) throw new Error('List not found');
      currentListId = id;
      saveListsState();
      return { success: true, currentListId };
    }
  },
  createList: async (name) => {
    try {
      const r = await fetch('/api/lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      if (!r.ok) throw new Error('create list failed');
      const data = await r.json();
      const list = data?.list;
      if (list) {
        // server also set current-list
        lists.push(list);
        currentListId = list.id;
        saveListsState();
        return { ...list };
      }
      throw new Error('no list in response');
    } catch (e) {
      cwarn('Create list API failed; creating LS fallback:', e);
      const newId = (lists.reduce((m, l) => Math.max(m, l.id || 0), 0) || 0) + 1;
      const now = Date.now();
      const list = { id: newId, name: name || `List ${newId}`, created_at: now, updated_at: now };
      lists.push(list);
      currentListId = list.id;
      saveListsState();
      return { ...list };
    }
  },
  renameList: async (id, name) => {
    try {
      const r = await fetch(`/api/lists/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      if (!r.ok) throw new Error('rename list failed');
      const data = await r.json();
      const list = data?.list;
      if (list) {
        const i = lists.findIndex(l => l.id === id);
        if (i !== -1) lists[i] = { ...list };
        saveListsState();
        return { ...list };
      }
      throw new Error('no list in response');
    } catch (e) {
      cwarn('Rename list API failed; updating LS as fallback:', e);
      const i = lists.findIndex(l => l.id === id);
      if (i === -1) throw new Error('List not found');
      lists[i] = { ...lists[i], name, updated_at: Date.now() };
      saveListsState();
      return { ...lists[i] };
    }
  },
  deleteList: async (id) => {
    try {
      const r = await fetch(`/api/lists/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('delete list failed');
      const data = await r.json();
      // Server may have changed current list; re-pull
      const listsRes = await db.getLists();
      const curRes = await db.getCurrentListId();
      return { success: true, currentListId: curRes };
    } catch (e) {
      cwarn('Delete list API failed; updating LS as fallback:', e);
      if (!lists.some(l => l.id === id)) throw new Error('List not found');
      todos = todos.filter(t => t.listId !== id);
      lists = lists.filter(l => l.id !== id);
      if (!lists.length) {
        const now = Date.now();
        lists = [{ id: 1, name: 'My Todo List', created_at: now, updated_at: now }];
      }
      currentListId = lists[0].id;
      compactPositions(currentListId);
      saveTodos();
      saveListsState();
      return { success: true, currentListId };
    }
  },

  // Todo operations (scoped to current list)
  getAllTodos: async () => {
    try {
      const listId = await db.getCurrentListId();
      const r = await fetch(`/api/todos?list_id=${listId}`);
      if (!r.ok) throw new Error('todos fetch failed');
      const data = await r.json();
      const rows = Array.isArray(data?.todos) ? data.todos : [];
      clog('Retrieved', rows.length, 'todos (API-backed) for list', listId);
      return rows.map(t => ({ ...t }));
    } catch (e) {
      cwarn('Todos API error:', e);
      throw e;
    }
  },

  createTodo: async (todo) => {
    try {
      const listId = await db.getCurrentListId();
      const payload = {
        text: todo?.text || '',
        completed: !!todo?.completed,
        isEmpty: !!todo?.isEmpty,
        parentId: todo?.parentId ?? null,
        isIndented: !!todo?.isIndented,
        position: todo?.position,
        listId
      };
      const r = await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!r.ok) throw new Error('create todo failed');
      const data = await r.json();
      const created = data?.todo;
      if (!created) throw new Error('no todo in response');
      return { ...created };
    } catch (e) {
      cwarn('Create todo API failed:', e);
      throw e;
    }
  },

  updateTodo: async (todo) => {
    // Try API first
    try {
      const payload = { ...todo };
      // Do not allow listId changes via this API; backend ignores but keep clean
      delete payload.listId;
      const r = await fetch(`/api/todos/${todo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!r.ok) throw new Error('update todo failed');
      const data = await r.json();
      const updated = data?.todo;
      if (!updated) throw new Error('no todo in response');
      clog('Updated todo (API-backed):', updated);
      return { ...updated };
    } catch (e) {
      cwarn('Update todo API failed:', e);
      throw e;
    }
  },
  
  updateTodoPositions: async (updatedTodos) => {
    if (!Array.isArray(updatedTodos) || updatedTodos.length === 0) {
      throw new Error('Invalid todos array');
    }
    try {
      // Shape payload to required fields
      const payload = updatedTodos.map(t => ({
        id: Number(t.id),
        position: Number(t.position),
        parentId: t.parentId == null ? null : Number(t.parentId),
        isIndented: !!t.isIndented
      }));
      const r = await fetch('/api/todos/positions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!r.ok) throw new Error('bulk positions update failed');
      const data = await r.json();
      if (!data?.ok) throw new Error('bulk positions not ok');
      console.log('Updated todo positions (API-backed):', { count: payload.length });
      return updatedTodos;
    } catch (e) {
      console.warn('Positions API failed:', e);
      throw e;
    }
  },
  
  deleteTodo: async (id, options = { cascade: true }) => {
    // Try API first
    try {
      const cascade = options?.cascade !== false;
      const r = await fetch(`/api/todos/${id}?cascade=${cascade ? 1 : 0}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('delete todo failed');
      const data = await r.json();
      const deletedIds = Array.isArray(data?.deletedIds) ? data.deletedIds : [id];
      const cascaded = !!data?.cascaded;
      const liftedIds = Array.isArray(data?.liftedIds) ? data.liftedIds : [];
      console.log('Deleted todo (API-backed):', { id, deletedIds, cascaded, liftedIds });
      return { success: true, deletedIds, cascaded, liftedIds };
    } catch (e) {
      console.warn('Delete todo API failed:', e);
      throw e;
    }
  }
};

export default db;