/**
 * Simple in-memory storage for todos
 * No persistence - data is lost on page refresh
 */

let nextId = 1;
let todos = [];
let settings = {
  title: 'My Todo List',
  dark_mode: false
};

const db = {
  // Settings operations
  getSettings: async () => {
    console.log('Retrieved settings from memory:', settings);
    return Promise.resolve({ ...settings });
  },
  
  updateTitle: async (title) => {
    settings.title = title;
    console.log('Updated title in memory:', title);
    return Promise.resolve({ success: true, title });
  },
  
  updateDarkMode: async (isDarkMode) => {
    settings.dark_mode = isDarkMode;
    console.log('Updated dark mode in memory:', isDarkMode);
    return Promise.resolve({ success: true, dark_mode: isDarkMode });
  },
  
  // Todo operations
  getAllTodos: async () => {
    console.log('Retrieved', todos.length, 'todos from memory');
    return Promise.resolve([...todos]);
  },
  
  createTodo: async (todo) => {
    const newTodo = {
      id: nextId++,
      text: todo.text || '',
      completed: todo.completed || false,
      isEmpty: todo.isEmpty !== undefined ? todo.isEmpty : true,
      parentId: todo.parentId || null,
      isIndented: todo.isIndented || false,
      position: todo.position || todos.length + 1
    };
    
    todos.push(newTodo);
    console.log('Created new todo in memory:', newTodo);
    return Promise.resolve(newTodo);
  },
  
  updateTodo: async (todo) => {
    const index = todos.findIndex(t => t.id === todo.id);
    if (index === -1) {
      throw new Error(`Todo with ID ${todo.id} not found`);
    }
    
    todos[index] = { ...todos[index], ...todo };
    console.log('Updated todo in memory:', todos[index]);
    return Promise.resolve(todos[index]);
  },
  
  updateTodoPositions: async (updatedTodos) => {
    if (!Array.isArray(updatedTodos) || updatedTodos.length === 0) {
      throw new Error('Invalid todos array');
    }
    
    console.log('Updating positions for', updatedTodos.length, 'todos in memory');
    
    // Update the todos array with new positions
    updatedTodos.forEach(updatedTodo => {
      const index = todos.findIndex(t => t.id === updatedTodo.id);
      if (index !== -1) {
        todos[index] = { ...todos[index], ...updatedTodo };
      }
    });
    
    console.log('Updated todo positions in memory');
    return Promise.resolve(updatedTodos);
  },
  
  deleteTodo: async (id, options = { cascade: true }) => {
    console.log('🔥 IN-MEMORY DELETE CALLED with ID:', id, 'options:', options);
    console.log('📋 Current todos in memory:', todos);
    
    const todoIndex = todos.findIndex(t => t.id === id);
    if (todoIndex === -1) {
      console.error('❌ Todo not found in memory with ID:', id);
      throw new Error(`Todo with ID ${id} not found`);
    }
    
    // Helper: recursively collect descendant IDs (children, grandchildren, ...)
    const collectDescendants = (parentIds) => {
      const result = [];
      const queue = [...parentIds];
      while (queue.length) {
        const pid = queue.shift();
        const children = todos.filter(t => t.parentId === pid).map(t => t.id);
        for (const cid of children) {
          if (!result.includes(cid)) {
            result.push(cid);
            queue.push(cid);
          }
        }
      }
      return result;
    };
    
    const descendantIds = collectDescendants([id]);
    const hasDescendants = descendantIds.length > 0;
    console.log('🧬 Descendant IDs for delete:', descendantIds);
    
    if (options.cascade) {
      const deletedIds = [id, ...descendantIds];
      console.log('🧹 Will delete IDs (cascade):', deletedIds);
      todos = todos.filter(t => !deletedIds.includes(t.id));
      // Recompute positions compactly
      todos = todos.map((t, idx) => ({ ...t, position: idx + 1 }));
      console.log('✅ Deleted todo and descendants from memory:', deletedIds);
      console.log('📋 Remaining todos in memory:', todos);
      return Promise.resolve({ success: true, deletedIds, cascaded: true });
    } else {
      // Lift all descendants to top-level (no parent, not indented), and delete only the target
      console.log('🔼 Lifting descendants and deleting only parent');
      todos = todos.filter(t => t.id !== id);
      if (hasDescendants) {
        todos = todos.map(t => (
          descendantIds.includes(t.id)
            ? { ...t, parentId: null, isIndented: false }
            : t
        ));
      }
      // Recompute positions compactly
      todos = todos.map((t, idx) => ({ ...t, position: idx + 1 }));
      console.log('✅ Deleted parent. Lifted descendants (if any). Remaining todos:', todos);
      return Promise.resolve({ success: true, deletedIds: [id], cascaded: false, liftedIds: descendantIds });
    }
  }
};

export default db;