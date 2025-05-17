import { useState, useRef, useEffect } from 'react'
import './App.css'

function App() {
  const [todos, setTodos] = useState([])
  const [editingId, setEditingId] = useState(null)
  const [editValue, setEditValue] = useState('')
  const [darkMode, setDarkMode] = useState(false)
  const [title, setTitle] = useState('My Todo List')
  const [editingTitle, setEditingTitle] = useState(false)
  const [draggedItem, setDraggedItem] = useState(null)
  const [showMenu, setShowMenu] = useState(false)
  const editInputRef = useRef(null)
  const titleInputRef = useRef(null)
  const lastEmptyIdRef = useRef(null)
  const clickPositionRef = useRef(0)
  const canvasRef = useRef(null)
  const listRef = useRef(null)
  const todoRefs = useRef({})
  const isDraggingRef = useRef(false)
  const dragStartYRef = useRef(0)
  const draggedIndexRef = useRef(null)
  const draggedElementRef = useRef(null)
  const targetIndexRef = useRef(null)
  const swapTimerRef = useRef(null)

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

  // Clean up any lingering drag operation on component unmount
  useEffect(() => {
    return () => {
      document.body.classList.remove('is-dragging');
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const toggleMenu = () => {
    setShowMenu(!showMenu);
  }

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

  // Set ref for todo item elements
  const setTodoItemRef = (element, id) => {
    if (element) {
      todoRefs.current[id] = element;
    }
  };
  
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
    // Don't start editing if we're dragging
    if (isDraggingRef.current) return;
    
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

  // New manual drag and drop implementation
  const handleDragStart = (e, todo, index) => {
    // Instead of preventing dragging when editing, just stop editing
    if (editingId !== null) {
      // If we're editing the current item being dragged, apply the edit first
      if (editingId === todo.id) {
        // Update the todo with current edit value
        setTodos(todos.map(t => 
          t.id === editingId ? { 
            ...t, 
            text: editValue.trim(),
            isEmpty: editValue.trim() === '' 
          } : t
        ));
      }
      
      // Exit edit mode
      setEditingId(null);
    }
    
    e.preventDefault(); // Prevent default drag behavior
    
    // Mark as dragging
    isDraggingRef.current = true;
    dragStartYRef.current = e.clientY;
    draggedIndexRef.current = index;
    draggedElementRef.current = todoRefs.current[todo.id];
    setDraggedItem(todo);
    
    // Add dragging class to body
    document.body.classList.add('is-dragging');
    
    // Add dragging class to the dragged element
    if (draggedElementRef.current) {
      draggedElementRef.current.classList.add('dragging');
      
      // Store the initial position
      const rect = draggedElementRef.current.getBoundingClientRect();
      draggedElementRef.current.style.position = 'fixed';
      draggedElementRef.current.style.top = `${rect.top}px`;
      draggedElementRef.current.style.width = `${rect.width}px`;
      draggedElementRef.current.style.zIndex = '1000';
      
      // Create a placeholder to maintain spacing
      const placeholder = document.createElement('div');
      placeholder.className = 'drag-placeholder';
      placeholder.style.height = `${rect.height}px`;
      placeholder.style.width = '100%';
      placeholder.style.margin = `${getComputedStyle(draggedElementRef.current).margin}`;
      placeholder.setAttribute('data-placeholder', 'true');
      draggedElementRef.current.parentNode.insertBefore(placeholder, draggedElementRef.current);
    }
    
    // Add global event listeners
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };
  
  const handleMouseMove = (e) => {
    if (!isDraggingRef.current || draggedIndexRef.current === null) return;
    
    const currentY = e.clientY;
    
    // Move the dragged element with the cursor
    if (draggedElementRef.current) {
      const moveY = currentY - dragStartYRef.current;
      const rect = draggedElementRef.current.getBoundingClientRect();
      draggedElementRef.current.style.top = `${rect.top + moveY}px`;
      dragStartYRef.current = currentY;
    }
    
    // Find the element the cursor is currently over
    const todoElements = Array.from(document.querySelectorAll('.todo-item:not(.dragging)'));
    const placeholder = document.querySelector('.drag-placeholder');
    
    // Calculate new target position
    let newTargetIndex = null;
    
    for (let i = 0; i < todoElements.length; i++) {
      // Skip the placeholder
      if (todoElements[i].hasAttribute('data-placeholder')) continue;
      
      const rect = todoElements[i].getBoundingClientRect();
      const middleY = rect.top + rect.height / 2;
      
      if (currentY < middleY) {
        newTargetIndex = i;
        break;
      }
    }
    
    // If we're past all elements, target the end of the list
    if (newTargetIndex === null) {
      newTargetIndex = todoElements.length;
    }
    
    // Map the visual index back to the data index
    const visualToDataIndexMap = new Map();
    let dataIndex = 0;
    
    for (let i = 0; i < todos.length; i++) {
      if (i === draggedIndexRef.current) continue;
      visualToDataIndexMap.set(dataIndex, i);
      dataIndex++;
    }
    
    // Convert visual index to data index
    const targetDataIndex = newTargetIndex < visualToDataIndexMap.size 
      ? visualToDataIndexMap.get(newTargetIndex) 
      : todos.length;
    
    // If the target has changed
    if (targetDataIndex !== targetIndexRef.current) {
      // Store positions before placeholder movement
      const initialPositions = new Map();
      todoElements.forEach(el => {
        if (!el.hasAttribute('data-placeholder')) {
          const rect = el.getBoundingClientRect();
          initialPositions.set(el, { top: rect.top, left: rect.left });
        }
      });
      
      // Update placeholder position
      if (placeholder) {
        placeholder.remove();
        
        if (newTargetIndex < todoElements.length) {
          todoElements[newTargetIndex].parentNode.insertBefore(placeholder, todoElements[newTargetIndex]);
        } else {
          // Append at the end
          listRef.current.appendChild(placeholder);
        }
      }
      
      // Compare final positions and apply FLIP animation
      requestAnimationFrame(() => {
        todoElements.forEach(el => {
          if (!el.hasAttribute('data-placeholder') && initialPositions.has(el)) {
            const initialPos = initialPositions.get(el);
            const finalRect = el.getBoundingClientRect();
            
            // Calculate the difference in position
            const deltaY = initialPos.top - finalRect.top;
            
            if (Math.abs(deltaY) > 1) { // Only animate if there's actual movement
              // First: set to initial position
              el.style.transform = `translateY(${deltaY}px)`;
              el.style.transition = 'none';
              
              // Then animate to final position (FLIP technique)
              requestAnimationFrame(() => {
                el.style.transition = 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
                el.style.transform = 'translateY(0)';
              });
            }
          }
        });
      });
      
      targetIndexRef.current = targetDataIndex;
    }
  };
  
  const handleMouseUp = () => {
    if (!isDraggingRef.current) return;
    
    // Remove placeholder
    const placeholder = document.querySelector('.drag-placeholder');
    if (placeholder) {
      placeholder.remove();
    }
    
    // Reorder the todos if the position changed
    if (draggedIndexRef.current !== null && targetIndexRef.current !== null && 
        draggedIndexRef.current !== targetIndexRef.current) {
      
      // Apply final animation
      const todoElements = document.querySelectorAll('.todo-item:not(.dragging)');
      todoElements.forEach(el => {
        // Wait for any ongoing animations to complete
        const handleTransitionEnd = () => {
          el.removeEventListener('transitionend', handleTransitionEnd);
          el.style.transition = '';
          el.style.transform = '';
        };
        
        el.addEventListener('transitionend', handleTransitionEnd);
        
        // If no transition in progress, clean up anyway
        if (!el.style.transform || el.style.transform === 'none' || el.style.transform === 'translateY(0px)') {
          el.style.transition = '';
          el.style.transform = '';
        }
      });
      
      const updatedTodos = [...todos];
      const [movedItem] = updatedTodos.splice(draggedIndexRef.current, 1);
      
      // Calculate the correct insert position
      let insertAt = targetIndexRef.current;
      if (targetIndexRef.current > draggedIndexRef.current) {
        insertAt--;
      }
      insertAt = Math.max(0, Math.min(insertAt, updatedTodos.length));
      
      updatedTodos.splice(insertAt, 0, movedItem);
      setTodos(updatedTodos);
    }
    
    // Reset dragged element style
    if (draggedElementRef.current) {
      draggedElementRef.current.style.position = '';
      draggedElementRef.current.style.top = '';
      draggedElementRef.current.style.width = '';
      draggedElementRef.current.style.zIndex = '';
    }
    
    // Clear styles and clean up
    const todoElements = document.querySelectorAll('.todo-item');
    todoElements.forEach(el => {
      el.classList.remove('dragging');
    });
    
    // Reset drag state
    isDraggingRef.current = false;
    draggedIndexRef.current = null;
    targetIndexRef.current = null;
    draggedElementRef.current = null;
    setDraggedItem(null);
    
    // Remove dragging class from body
    document.body.classList.remove('is-dragging');
    
    // Remove global event listeners
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  };

  return (
    <div className={`todo-app ${darkMode ? 'dark-mode' : ''}`}>
      <div className="top-buttons">
        {!showMenu ? (
          <>
            <button className="menu-btn" onClick={toggleMenu}>
              <img 
                src="/images/menu_button.svg" 
                alt="Menu" 
                width="24" 
                height="24"
                className="menu-icon"
              />
            </button>
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
          </>
        ) : (
          <button className="close-menu-btn" onClick={toggleMenu}>
            <img 
              src="/images/deleteitem.svg" 
              alt="Close menu" 
              width="24" 
              height="24"
              className="close-icon"
            />
          </button>
        )}
      </div>
      
      {!showMenu ? (
        <>
          {editingTitle ? (
            <input
              type="text"
              className="title-edit-input"
              defaultValue={title}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') handleTitleEdit(e);
              }}
              onBlur={handleTitleEdit}
              ref={titleInputRef}
              autoComplete="off"
              onMouseDown={(e) => e.stopPropagation()}
            />
          ) : (
            <h1 onClick={startTitleEdit}>{title}</h1>
          )}
          
          <ul className="todo-list" ref={listRef}>
            {todos.length === 0 && (
              <li className="empty-list">No tasks yet. Add one to get started!</li>
            )}
            
            {todos.map((todo, index) => (
              <li 
                key={todo.id} 
                className={`todo-item ${todo.completed ? 'completed' : ''} ${todo.isEmpty ? 'empty-item' : ''}`}
                ref={(element) => setTodoItemRef(element, todo.id)}
              >
                <div 
                  className="drag-handle" 
                  onMouseDown={(e) => handleDragStart(e, todo, index)}
                  title="Drag to reorder"
                >
                  <img 
                    src="/images/drag_grip.svg" 
                    alt="Drag handle" 
                    width="18" 
                    height="18"
                    className="drag-icon"
                  />
                </div>
                
                <div className="todo-checkbox-container" onClick={(e) => e.stopPropagation()}>
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
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') handleEditTodo(e, todo.id);
                    }}
                    onBlur={(e) => handleEditTodo(e, todo.id)}
                    ref={setEditInputRef}
                    placeholder="Empty task"
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span 
                    className="todo-text" 
                    onClick={(e) => startTaskEdit(todo, e)}
                  >
                    {todo.text || <span className="placeholder-text">Empty task</span>}
                  </span>
                )}
                
                <button className="delete-btn" onClick={(e) => {
                  e.stopPropagation();
                  deleteTodo(todo.id);
                }}>
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
        </>
      ) : (
        <div className="menu-screen">
          {/* Empty menu screen */}
        </div>
      )}
    </div>
  )
}

export default App
