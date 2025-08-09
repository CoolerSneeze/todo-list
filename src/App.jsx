import { useState, useRef, useEffect } from 'react'
import './App.css'
import db from './db.js'

function App() {
  const [todos, setTodos] = useState([])
  const [editingId, setEditingId] = useState(null)
  const [editValue, setEditValue] = useState('')
  const [darkMode, setDarkMode] = useState(false)
  const [title, setTitle] = useState('My Todo List')
  const [editingTitle, setEditingTitle] = useState(false)
  const [draggedItem, setDraggedItem] = useState(null)
  const [showMenu, setShowMenu] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const editInputRef = useRef(null)
  const titleInputRef = useRef(null)
  const lastEmptyIdRef = useRef(null)
  const clickPositionRef = useRef(0)
  const canvasRef = useRef(null)
  const listRef = useRef(null)
  const todoRefs = useRef({})
  const isDraggingRef = useRef(false)
  const dragStartYRef = useRef(0)
  const dragStartXRef = useRef(0) // Track X position for horizontal movement
  const draggedIndexRef = useRef(null)
  const draggedElementRef = useRef(null)
  const targetIndexRef = useRef(null)
  const swapTimerRef = useRef(null)
  const dragDirectionRef = useRef(null) // 'vertical' or 'horizontal'
  const dragOffsetXRef = useRef(0) // Track horizontal offset
  const dragThresholdPassed = useRef(false) // Threshold for determining drag direction

  // Load data from database on first render
  useEffect(() => {
    const loadData = async () => {
      try {
        // Load settings
        const settings = await db.getSettings();
        setDarkMode(!!settings.dark_mode);
        setTitle(settings.title);
        
        // Load todos
        const loadedTodos = await db.getAllTodos();
        
        // Sort todos by position
        const sortedTodos = [...loadedTodos].sort((a, b) => 
          (Number(a.position) || 0) - (Number(b.position) || 0)
        );
        
        setTodos(sortedTodos);
      } catch (error) {
        console.error('Error loading data from database:', error);
      } finally {
        setIsLoading(false);
      }
    };
    
    loadData();
  }, []);

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
  }, [darkMode]);

  // Save dark mode setting to database when it changes
  useEffect(() => {
    if (!isLoading) {
      db.updateDarkMode(darkMode).catch(error => {
        console.error('Error saving dark mode setting:', error);
      });
    }
  }, [darkMode, isLoading]);

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

  const addEmptyTodo = async () => {
    // Prevent multiple rapid clicks by checking if we're already creating a todo
    if (editingId !== null && lastEmptyIdRef.current !== null) {
      console.log('Already creating/editing a todo, ignoring additional clicks');
      return;
    }
    
    // Calculate the position for the new todo
    const position = todos.length > 0 
      ? Math.max(...todos.map(t => Number(t.position) || 0)) + 1 
      : 1;
    
    const newTodo = { 
      text: '', 
      completed: false, 
      isEmpty: true, 
      parentId: null, 
      isIndented: false,
      position: position
    }
    
    try {
      console.log('Creating single new todo at position', position);
      
      // Add to database
      const savedTodo = await db.createTodo(newTodo);
      
      // Update state with the new todo
      setTodos(prevTodos => [...prevTodos, savedTodo]);
      
      // Set editing mode for the new item
      setEditingId(savedTodo.id);
      setEditValue('');
      lastEmptyIdRef.current = savedTodo.id;
      
      console.log('Successfully created new todo with ID:', savedTodo.id);
      
    } catch (error) {
      console.error('Error adding new todo:', error);
      alert('Failed to create new todo. Please try again.');
    }
  }

  const handleEditTodo = async (e, id) => {
    if (e.key === 'Enter' || e.type === 'blur') {
      // Get current todo
      const currentTodo = todos.find(todo => todo.id === id);
      if (!currentTodo) return;
      
      const trimmedText = editValue.trim();
      
      // Create updated todo
      const updatedTodo = { 
        ...currentTodo,
        text: trimmedText,
        isEmpty: trimmedText === '',
        // Explicitly preserve indentation status and parent relationship
        isIndented: !!currentTodo.isIndented,
        parentId: currentTodo.parentId
      };
      
      try {
        console.log('Saving todo with text:', trimmedText);
        
        // Update in database
        await db.updateTodo(updatedTodo);
        
        // Update state
        setTodos(todos.map(todo => 
          todo.id === id ? updatedTodo : todo
        ));
        
        // Clear the lastEmptyIdRef if we're editing that item
        if (id === lastEmptyIdRef.current) {
          lastEmptyIdRef.current = null;
        }
        
        // Exit editing mode
        setEditingId(null);
        
        console.log('Todo saved successfully');
        
      } catch (error) {
        console.error('Error updating todo:', error);
        alert('Failed to save todo. Please try again.');
      }
    }
  }

  const toggleTodo = async (id) => {
    try {
      // Get current todo
      const currentTodo = todos.find(todo => todo.id === id);
      if (!currentTodo) {
        console.error(`Cannot toggle todo with ID ${id} - not found`);
        return;
      }
      
      // Create updated todo with toggled completion status
      const updatedTodo = { 
        ...currentTodo,
        completed: !currentTodo.completed,
        // Explicitly preserve indentation status and parent relationship
        isIndented: !!currentTodo.isIndented,
        parentId: currentTodo.parentId
      };
      
      console.log(`Toggling completion for todo ${id} from ${currentTodo.completed} to ${updatedTodo.completed}`);
      
      // Update UI state immediately for responsiveness
      setTodos(todos.map(todo => 
        todo.id === id ? updatedTodo : todo
      ));
      
      // Update in database - ensure ID is a number and completed is a boolean
      await db.updateTodo({
        ...updatedTodo,
        id: Number(id),
        completed: !!updatedTodo.completed // Ensure it's a boolean
      });
      
      console.log('Todo toggle saved successfully');
      
    } catch (error) {
      console.error('Error updating todo completion status:', error);
      
      // On error, revert the UI change
      setTodos(todos.map(todo => 
        todo.id === id ? currentTodo : todo
      ));
    }
  };

  const deleteTodo = async (id) => {
    try {
      console.log(`🗑️ DELETE BUTTON CLICKED - Deleting todo with ID: ${id}`);
      console.log('Current todos before delete:', todos);
      
      // If we're deleting the item we're editing, stop editing
      if (Number(id) === editingId) {
        setEditingId(null);
      }
      
      // Delete from database - ensure ID is a number
      console.log('🔄 Calling db.deleteTodo...');
      const result = await db.deleteTodo(Number(id));
      console.log('✅ Delete result:', result);
      
      if (result && result.deletedIds && Array.isArray(result.deletedIds)) {
        // Convert all IDs to numbers to ensure consistent comparison
        const deletedIdSet = new Set(result.deletedIds.map(Number));
        console.log('Filtering out todos with IDs:', [...deletedIdSet]);
        
        const updatedTodos = todos.filter(todo => !deletedIdSet.has(Number(todo.id)));
        console.log('Todos after deletion:', updatedTodos);
        
        // Update state
        setTodos(updatedTodos);
      } else {
        // Fallback: remove the todo and any children
        console.warn('Delete response did not contain deletedIds, falling back to simple filter');
        const updatedTodos = todos.filter(todo => {
          const todoId = Number(todo.id);
          const targetId = Number(id);
          const parentId = todo.parentId ? Number(todo.parentId) : null;
          
          // Remove the target todo and any todos that have it as a parent
          return todoId !== targetId && parentId !== targetId;
        });
        setTodos(updatedTodos);
      }
      
      console.log('Todo deleted successfully');
      
    } catch (error) {
      console.error('Error deleting todo:', error);
      // Show user-friendly error message but don't refresh automatically
      alert('Failed to delete todo. Please try again.');
    }
  };

  const toggleDarkMode = () => {
    setDarkMode(!darkMode);
  }

  const handleTitleEdit = async (e) => {
    if (e.key === 'Enter' || e.type === 'blur') {
      // Only save non-empty titles
      if (e.target.value.trim()) {
        const newTitle = e.target.value.trim();
        
        try {
          console.log('Saving new title:', newTitle);
          // Update in database
          const result = await db.updateTitle(newTitle);
          console.log('Title update result:', result);
          
          // Update state
          setTitle(newTitle);
        } catch (error) {
          console.error('Error updating title:', error);
          // If there was an error, refresh from server to ensure consistency
          try {
            const settings = await db.getSettings();
            setTitle(settings.title);
          } catch (refreshError) {
            console.error('Failed to refresh title after update error:', refreshError);
          }
        }
      }
      setEditingTitle(false);
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

  // New manual drag and drop implementation with horizontal indentation support
  const handleDragStart = (e, todo, index) => {
    // Instead of preventing dragging when editing, just stop editing
    if (editingId !== null) {
      // If we're editing the current item being dragged, apply the edit first
      if (editingId === todo.id) {
        // Update the todo with current edit value
        const updatedTodo = {
          ...todo,
          text: editValue.trim(),
          isEmpty: editValue.trim() === ''
        };
        
        // Update in database and state
        db.updateTodo(updatedTodo)
          .then(() => {
            setTodos(todos.map(t => 
              t.id === editingId ? updatedTodo : t
            ));
          })
          .catch(error => {
            console.error('Error updating todo:', error);
          });
      }
      
      // Exit edit mode
      setEditingId(null);
    }
    
    e.preventDefault(); // Prevent default drag behavior
    
    // Store the initial indentation state
    const initialIndentationState = {
      isIndented: !!todo.isIndented,
      parentId: todo.parentId
    };
    
    // Mark as dragging
    isDraggingRef.current = true;
    dragStartYRef.current = e.clientY;
    dragStartXRef.current = e.clientX;
    draggedIndexRef.current = index;
    draggedElementRef.current = todoRefs.current[todo.id];
    setDraggedItem({...todo, initialIndentationState});
    dragDirectionRef.current = null; // Reset direction at start
    dragThresholdPassed.current = false;
    dragOffsetXRef.current = 0; // Reset horizontal offset
    
    // Add dragging class to body
    document.body.classList.add('is-dragging');
    
    // Add dragging class to the dragged element
    if (draggedElementRef.current) {
      draggedElementRef.current.classList.add('dragging');
      draggedElementRef.current.style.zIndex = '1000';
      
      // For vertical dragging, we need position: fixed and placeholder
      // For horizontal dragging, we'll handle positioning differently
      // We'll determine the direction later and adjust accordingly
    }
    
    // Add global event listeners
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };
  
  const handleMouseMove = (e) => {
    if (!isDraggingRef.current || draggedIndexRef.current === null) return;
    
    const currentY = e.clientY;
    const currentX = e.clientX;
    
    // Calculate the distance moved to determine drag direction
    const deltaY = Math.abs(currentY - dragStartYRef.current);
    const deltaX = Math.abs(currentX - dragStartXRef.current);
    
    // Determine drag direction if not already set and past threshold
    if (!dragDirectionRef.current && !dragThresholdPassed.current) {
      // Only set direction after a minimum threshold
      if (deltaY > 10 || deltaX > 10) {
        dragThresholdPassed.current = true;
        // Set direction based on which axis has more movement
        dragDirectionRef.current = deltaX > deltaY ? 'horizontal' : 'vertical';
        
        // Add appropriate class to dragged element and set up positioning
        if (draggedElementRef.current) {
          draggedElementRef.current.classList.add(`dragging-${dragDirectionRef.current}`);
          
          // Set up positioning based on drag direction
          if (dragDirectionRef.current === 'vertical') {
            // For vertical dragging, use position: fixed and create placeholder
            const rect = draggedElementRef.current.getBoundingClientRect();
            
            // Check if this is an indented item to avoid double-offset
            const draggedItem = todos[draggedIndexRef.current];
            const isIndented = !!draggedItem.isIndented;
            const leftPosition = isIndented ? rect.left - 60 : rect.left; // Subtract CSS transform offset
            
            draggedElementRef.current.style.position = 'fixed';
            draggedElementRef.current.style.top = `${rect.top}px`;
            draggedElementRef.current.style.left = `${leftPosition}px`;
            draggedElementRef.current.style.width = `${rect.width}px`;
            
            // Create a placeholder to maintain spacing
            const placeholder = document.createElement('div');
            placeholder.className = 'drag-placeholder';
            placeholder.style.height = `${rect.height}px`;
            placeholder.style.width = '100%';
            placeholder.style.margin = `${getComputedStyle(draggedElementRef.current).margin}`;
            placeholder.setAttribute('data-placeholder', 'true');
            draggedElementRef.current.parentNode.insertBefore(placeholder, draggedElementRef.current);
          } else if (dragDirectionRef.current === 'horizontal') {
            // For horizontal dragging, keep element in normal flow
            // No position: fixed, no placeholder - just use transform
            draggedElementRef.current.style.transition = 'none';
          }
        }
      }
    }
    
    // Move the dragged element with the cursor based on direction
    if (draggedElementRef.current) {
      if (dragDirectionRef.current === 'vertical') {
        // Vertical movement only
        const moveY = currentY - dragStartYRef.current;
        const rect = draggedElementRef.current.getBoundingClientRect();
        draggedElementRef.current.style.top = `${rect.top + moveY}px`;
        dragStartYRef.current = currentY;
      } else if (dragDirectionRef.current === 'horizontal') {
        // Horizontal movement - simple smooth sliding in normal flow
        const dragEl = draggedElementRef.current;
        
        // Calculate movement relative to drag start position
        const totalMoveX = currentX - dragStartXRef.current;
        
        // Get the dragged item to check if it's currently indented
        const draggedItem = todos[draggedIndexRef.current];
        const isCurrentlyIndented = !!draggedItem.isIndented;
        
        // Base offset for indented items (they have CSS transform: translateX(60px))
        const baseOffset = isCurrentlyIndented ? 60 : 0;
        
        // Allow movement to cover the full indentation range (60px)
        const maxIndentX = 60;
        const minIndentX = -60;
        
        // Simple clamped movement
        dragOffsetXRef.current = Math.max(minIndentX, Math.min(maxIndentX, totalMoveX));
        
        // Apply transform: base offset + drag offset
        const totalTransform = baseOffset + dragOffsetXRef.current;
        dragEl.style.transform = `translateX(${totalTransform}px)`;
        
        // Visual feedback for indentation threshold
        if (dragOffsetXRef.current > 30) {
          dragEl.classList.add('indent-preview');
        } else {
          dragEl.classList.remove('indent-preview');
        }
        
        return; // Skip vertical positioning logic when in horizontal mode
      }
    }
    
    // Skip vertical repositioning logic if we're in horizontal dragging mode
    if (dragDirectionRef.current === 'horizontal') {
      return;
    }
    
    // Handle vertical dragging (reordering)
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
              // Check if this element is indented to preserve horizontal offset
              const isIndented = el.classList.contains('indented');
              const baseTransform = isIndented ? 'translateX(60px)' : '';
              
              // First: set to initial position (preserve horizontal transform)
              const initialTransform = baseTransform ? `${baseTransform} translateY(${deltaY}px)` : `translateY(${deltaY}px)`;
              el.style.transform = initialTransform;
              el.style.transition = 'none';
              
              // Then animate to final position (FLIP technique)
              requestAnimationFrame(() => {
                el.style.transition = 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
                el.style.transform = baseTransform; // Return to base transform (preserves indentation)
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
    
    // Get dragged item's data
    const draggedItem = todos[draggedIndexRef.current];
    let updatedTodos = [...todos];
    let positionsChanged = false;
    let indentationChanged = false;
    
    // Handle indentation changes
    if (dragDirectionRef.current === 'horizontal') {
      // Determine final indentation based on horizontal movement
      const wasIndented = !!draggedItem.isIndented;
      let shouldBeIndented;
      
      if (wasIndented) {
        // If item was indented, unindent if dragged left more than 30px
        shouldBeIndented = dragOffsetXRef.current > -30;
      } else {
        // If item was not indented, indent if dragged right more than 30px
        shouldBeIndented = dragOffsetXRef.current > 30;
      }
      
      // Compare with initial state to see if it changed
      const initialState = draggedItem.initialIndentationState || {
        isIndented: !!draggedItem.isIndented,
        parentId: draggedItem.parentId
      };
      
      // Only update if indentation state changed
      if (shouldBeIndented !== initialState.isIndented) {
        if (shouldBeIndented && draggedIndexRef.current > 0) {
          // Find the previous item (potential parent)
          const parentIndex = draggedIndexRef.current - 1;
          const parentId = Number(todos[parentIndex].id);
          
          // Update todos with new indentation
          updatedTodos = updatedTodos.map(todo => 
            Number(todo.id) === Number(draggedItem.id) 
              ? { ...todo, isIndented: shouldBeIndented, parentId } 
              : todo
          );
          
          indentationChanged = true;
        } else if (!shouldBeIndented && draggedItem.isIndented) {
          // Remove indentation
          updatedTodos = updatedTodos.map(todo => 
            Number(todo.id) === Number(draggedItem.id) 
              ? { ...todo, isIndented: false, parentId: null } 
              : todo
          );
          
          indentationChanged = true;
        }
      }
    }
    
    // Handle vertical reordering
    if (dragDirectionRef.current === 'vertical' && 
        draggedIndexRef.current !== null && 
        targetIndexRef.current !== null && 
        draggedIndexRef.current !== targetIndexRef.current) {
      
      // Remove item from current position
      const [movedItem] = updatedTodos.splice(draggedIndexRef.current, 1);
      
      // Calculate the correct insert position
      let insertAt = targetIndexRef.current;
      if (targetIndexRef.current > draggedIndexRef.current) {
        insertAt--;
      }
      insertAt = Math.max(0, Math.min(insertAt, updatedTodos.length));
      
      // Check for possible parent-child relationship
      const previousItem = insertAt > 0 ? updatedTodos[insertAt - 1] : null;
      
      // Validate parent-child relationships
      if (insertAt === 0) {
        // If moved to the top, remove indentation
        movedItem.isIndented = false;
        movedItem.parentId = null;
      } else if (movedItem.isIndented) {
        // If item is indented, validate that it can have the previous item as parent
        if (!previousItem || previousItem.isIndented) {
          // Previous item is also indented (child), so this item can't be indented
          // OR no previous item exists, so remove indentation
          movedItem.isIndented = false;
          movedItem.parentId = null;
        } else {
          // Previous item is not indented (parent), so update parent relationship
          movedItem.parentId = Number(previousItem.id);
        }
      }
      
      // Insert the moved item at the new position
      updatedTodos.splice(insertAt, 0, movedItem);
      positionsChanged = true;
    }
    
    // Post-process: Fix any invalid parent-child relationships after reordering
    if (positionsChanged) {
      let relationshipsFixed = false;
      updatedTodos = updatedTodos.map((todo, index) => {
        if (todo.isIndented) {
          // Check if this indented item has a valid parent
          if (index === 0) {
            // First item can't be indented
            relationshipsFixed = true;
            return { ...todo, isIndented: false, parentId: null };
          } else {
            const previousItem = updatedTodos[index - 1];
            if (previousItem.isIndented) {
              // Previous item is also indented (child), so this can't be indented
              relationshipsFixed = true;
              return { ...todo, isIndented: false, parentId: null };
            } else {
              // Previous item is valid parent, update parentId if needed
              if (todo.parentId !== Number(previousItem.id)) {
                relationshipsFixed = true;
                return { ...todo, parentId: Number(previousItem.id) };
              }
            }
          }
        }
        return todo;
      });
      
      if (relationshipsFixed) {
        indentationChanged = true;
      }
    }
    
    // Update the database if anything changed
    if (positionsChanged || indentationChanged) {
      // For horizontal drags, we need to prevent visual jumping
      let compensatingTransform = 0;
      if (dragDirectionRef.current === 'horizontal' && indentationChanged) {
        // Calculate the visual jump that will occur when CSS indentation is applied/removed
        const draggedItem = todos[draggedIndexRef.current];
        const wasIndented = !!draggedItem.isIndented;
        const willBeIndented = updatedTodos.find(t => Number(t.id) === Number(draggedItem.id))?.isIndented;
        
        if (!wasIndented && willBeIndented) {
          // Item is becoming indented: CSS will add 60px offset, so compensate with +60px to maintain position
          compensatingTransform = 60;
        } else if (wasIndented && !willBeIndented) {
          // Item is becoming unindented: CSS will remove 60px offset, so compensate with -60px to maintain position
          compensatingTransform = -60;
        }
      }
      
      // Ensure all todos have proper position values
      const todosWithUpdatedPositions = updatedTodos.map((todo, index) => ({
        ...todo,
        position: index + 1 // 1-based position
      }));
      
      // Update UI state immediately
      setTodos(todosWithUpdatedPositions);
      
      // Apply compensating transform to prevent visual jump
      if (compensatingTransform !== 0 && draggedElementRef.current) {
        draggedElementRef.current.style.transform = `translateX(${compensatingTransform}px)`;
        
        // Remove the compensating transform after a brief moment to let it settle naturally
        requestAnimationFrame(() => {
          if (draggedElementRef.current) {
            draggedElementRef.current.style.transition = 'transform 0.1s ease-out';
            draggedElementRef.current.style.transform = '';
          }
        });
      }
      
      // Update positions in database - this includes parent-child relationships
      db.updateTodoPositions(todosWithUpdatedPositions)
        .then(serverTodos => {
          if (serverTodos && Array.isArray(serverTodos)) {
            console.log('Server confirmed position update');
          }
        })
        .catch(error => {
          console.error('Error updating todo positions:', error);
          // If there was an error, refresh from server to ensure consistency
          db.getAllTodos().then(serverTodos => {
            setTodos(serverTodos);
          });
        });
    } else {
      console.log('Drag operation did not result in any changes');
    }
    
    // Reset dragged element style
    if (draggedElementRef.current) {
      draggedElementRef.current.style.position = '';
      draggedElementRef.current.style.top = '';
      draggedElementRef.current.style.left = '';
      draggedElementRef.current.style.width = '';
      draggedElementRef.current.style.zIndex = '';
      
      // For horizontal drags with indentation changes, the transform is handled above
      // For all other cases, clear the transform
      if (!(dragDirectionRef.current === 'horizontal' && indentationChanged)) {
        draggedElementRef.current.style.transform = '';
      }
      
      draggedElementRef.current.classList.remove('indent-preview');
    }
    
    // Clear styles and clean up
    const todoElements = document.querySelectorAll('.todo-item');
    todoElements.forEach(el => {
      el.classList.remove('dragging');
      el.classList.remove('dragging-vertical');
      el.classList.remove('dragging-horizontal');
      el.classList.remove('indent-preview');
      el.style.transform = '';
    });
    
    // Reset drag state
    isDraggingRef.current = false;
    draggedIndexRef.current = null;
    targetIndexRef.current = null;
    draggedElementRef.current = null;
    dragDirectionRef.current = null;
    dragOffsetXRef.current = 0;
    dragThresholdPassed.current = false;
    setDraggedItem(null);
    
    // Remove dragging class from body
    document.body.classList.remove('is-dragging');
    
    // Remove global event listeners
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  };

  if (isLoading) {
    return <div className="loading">Loading...</div>;
  }

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
            <button 
              className="add-btn" 
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                addEmptyTodo();
              }}
              title="Add new todo item"
            >
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
              value={title}
              onChange={(e) => setTitle(e.target.value)}
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
                className={`todo-item ${todo.completed ? 'completed' : ''} ${todo.isEmpty ? 'empty-item' : ''} ${todo.isIndented ? 'indented' : ''}`}
                ref={(element) => setTodoItemRef(element, todo.id)}
              >
                <div 
                  className="drag-handle" 
                  onMouseDown={(e) => handleDragStart(e, todo, index)}
                  title="Drag to reorder or indent"
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
                  <label className="custom-checkbox" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="hidden-checkbox"
                      checked={todo.completed}
                      onChange={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        toggleTodo(todo.id);
                      }}
                    />
                    <img 
                      src={todo.completed ? "/images/checkboxfull.svg" : "/images/checkboxempty.svg"} 
                      alt={todo.completed ? "Checked" : "Unchecked"} 
                      className="checkbox-image" 
                      width="20" 
                      height="20"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        toggleTodo(todo.id);
                      }}
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
                
                <button 
                  className="delete-btn" 
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteTodo(todo.id);
                  }}
                  onMouseDown={(e) => e.stopPropagation()} // Prevent drag start
                >
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
