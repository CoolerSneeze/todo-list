import { useState, useRef, useEffect } from 'react'
import './App.css'

function App() {
  const [todos, setTodos] = useState([])
  const [editingId, setEditingId] = useState(null)
  const [editValue, setEditValue] = useState('')
  const [darkMode, setDarkMode] = useState(false)
  const [title, setTitle] = useState('My Todo List')
  const [editingTitle, setEditingTitle] = useState(false)
  const editInputRef = useRef(null)
  const titleInputRef = useRef(null)
  const lastEmptyIdRef = useRef(null)
  const clickPositionRef = useRef(0)
  const canvasRef = useRef(null)

  // Create canvas for text measurement on first render
  useEffect(() => {
    canvasRef.current = document.createElement('canvas');
  }, []);

  // Focus the title input and set cursor position
  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus()
      titleInputRef.current.setSelectionRange(clickPositionRef.current, clickPositionRef.current);
    }
  }, [editingTitle]);

  // Focus the edit input when editingId changes
  useEffect(() => {
    if (editingId !== null && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.setSelectionRange(clickPositionRef.current, clickPositionRef.current);
    }
  }, [editingId]);

  // Update the document body class when darkMode changes
  useEffect(() => {
    if (darkMode) {
      document.body.classList.add('dark-mode')
    } else {
      document.body.classList.remove('dark-mode')
    }
  }, [darkMode])

  const addEmptyTodo = () => {
    const newTodo = { id: Date.now(), text: '', completed: false, isEmpty: true }
    setTodos([...todos, newTodo])
    
    // Only set editing for the new item if we're not currently editing
    if (editingId === null) {
      setEditingId(newTodo.id)
      setEditValue('')
      lastEmptyIdRef.current = newTodo.id
    }
  }

  const handleEditTodo = (e, id) => {
    if (e.key === 'Enter' || e.type === 'blur') {
      // Always update the text, even if it's empty
      setTodos(todos.map(todo => 
        todo.id === id ? { 
          ...todo, 
          text: editValue.trim(),
          // Mark as empty if the text is empty 
          isEmpty: editValue.trim() === '' 
        } : todo
      ))
      
      // Clear the lastEmptyIdRef if we're editing that item
      if (id === lastEmptyIdRef.current) {
        lastEmptyIdRef.current = null
      }
      
      // Exit editing mode
      setEditingId(null)
    }
  }

  const toggleTodo = (id) => {
    setTodos(todos.map(todo => 
      todo.id === id ? { ...todo, completed: !todo.completed } : todo
    ))
  }

  const deleteTodo = (id) => {
    setTodos(todos.filter(todo => todo.id !== id))
    
    // If we're deleting the item we're editing, stop editing
    if (id === editingId) {
      setEditingId(null)
    }
  }

  const toggleDarkMode = () => {
    setDarkMode(!darkMode)
  }

  const handleTitleEdit = (e) => {
    if (e.key === 'Enter' || e.type === 'blur') {
      // Only save non-empty titles
      if (e.target.value.trim()) {
        setTitle(e.target.value.trim())
      }
      setEditingTitle(false)
    }
  }

  // Set up edit input ref with correct styling
  const setEditInputRef = (element) => {
    if (element) {
      editInputRef.current = element
      element.style.paddingTop = '0px'
    }
  }
  
  // Calculate cursor position by directly measuring text with click coordinates
  const getClickPosition = (e, textElement, text) => {
    if (!text) return 0;
    
    // Get the element's bounding rectangle
    const rect = textElement.getBoundingClientRect();
    
    // Get click position relative to the element
    const x = e.clientX - rect.left;
    
    // Direct pixel-based approach - go character by character and find closest match
    let currentPosition = 0;
    let bestDistance = Infinity;
    let bestPosition = 0;
    
    // Get computed style to set canvas font
    const computedStyle = window.getComputedStyle(textElement);
    const ctx = canvasRef.current.getContext('2d');
    ctx.font = `${computedStyle.fontWeight} ${computedStyle.fontSize} ${computedStyle.fontFamily}`;
    ctx.textBaseline = 'top';
    
    // Check position character by character to find closest match
    while (currentPosition <= text.length) {
      const textPortion = text.substring(0, currentPosition);
      const measure = ctx.measureText(textPortion);
      const distance = Math.abs(measure.width - x);
      
      if (distance < bestDistance) {
        bestDistance = distance;
        bestPosition = currentPosition;
      }
      
      currentPosition++;
    }
    
    return bestPosition;
  }
  
  // Start editing title with cursor at click position
  const startTitleEdit = (e) => {
    if (!canvasRef.current) return;
    clickPositionRef.current = getClickPosition(e, e.target, title);
    setEditingTitle(true);
  }
  
  // Start editing task with cursor at click position
  const startTaskEdit = (todo, e) => {
    if (!canvasRef.current) return;
    const text = todo.text || '';
    // Find the actual text element (might be a child element)
    let textElement = e.target;
    if (textElement.className !== 'todo-text') {
      textElement = textElement.closest('.todo-text');
    }
    if (!textElement) textElement = e.target;
    
    clickPositionRef.current = getClickPosition(e, textElement, text);
    setEditValue(text);
    setEditingId(todo.id);
  }

  return (
    <div className={`todo-app ${darkMode ? 'dark-mode' : ''}`}>
      <div className="top-buttons">
        <button className="add-btn" onClick={addEmptyTodo}>
          <img 
            src="/images/additem.svg" 
            alt="Add new task" 
            width="24" 
            height="24"
            className="add-icon"
          />
        </button>
        <button className="dark-mode-btn" onClick={toggleDarkMode}>
          <img 
            src={darkMode ? "/images/lightmode.svg" : "/images/darkmode.svg"} 
            alt={darkMode ? "Switch to light mode" : "Switch to dark mode"} 
            width="24" 
            height="24"
            className="mode-icon"
          />
        </button>
      </div>
      
      {editingTitle ? (
        <input
          type="text"
          className="title-edit-input"
          defaultValue={title}
          onKeyDown={(e) => e.key === 'Enter' && handleTitleEdit(e)}
          onBlur={handleTitleEdit}
          ref={titleInputRef}
          autoComplete="off"
        />
      ) : (
        <h1 onClick={startTitleEdit}>{title}</h1>
      )}
      
      <ul className="todo-list">
        {todos.map(todo => (
          <li key={todo.id} className={`todo-item ${todo.completed ? 'completed' : ''} ${todo.isEmpty ? 'empty-item' : ''}`}>
            <div className="todo-checkbox-container">
              <label className="custom-checkbox">
                <input
                  type="checkbox"
                  className="hidden-checkbox"
                  checked={todo.completed}
                  onChange={() => toggleTodo(todo.id)}
                />
                <img 
                  src={todo.completed ? "/images/checkboxfull.svg" : "/images/checkboxempty.svg"} 
                  alt={todo.completed ? "Checked" : "Unchecked"} 
                  className="checkbox-image" 
                  width="20" 
                  height="20"
                />
              </label>
            </div>
            
            {editingId === todo.id ? (
              <input
                type="text"
                className="edit-input"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleEditTodo(e, todo.id)}
                onBlur={(e) => handleEditTodo(e, todo.id)}
                ref={setEditInputRef}
                placeholder="Empty task"
              />
            ) : (
              <span 
                className="todo-text" 
                onClick={(e) => startTaskEdit(todo, e)}
              >
                {todo.text || <span className="placeholder-text">Empty task</span>}
              </span>
            )}
            
            <button className="delete-btn" onClick={() => deleteTodo(todo.id)}>
              <img 
                src="/images/deleteitem.svg" 
                alt="Delete task" 
                width="18" 
                height="18"
                className="delete-icon"
              />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default App
