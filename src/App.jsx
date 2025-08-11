import { useState, useRef, useEffect } from 'react'
import ReactDOM from 'react-dom'
import './App.css'
import db from './db.js'
// Feature flag for custom delete modal. Enabled.
const USE_CUSTOM_DELETE_MODAL = true;
// Shared animation settings for smooth, bouncy drop easing
const DROP_DURATION_MS = 400;
const DROP_EASE = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
// Accessibility: respect reduced motion
const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function App() {
  const [todos, setTodos] = useState([])
  const [editingId, setEditingId] = useState(null)
  const [editValue, setEditValue] = useState('')
  const [darkMode, setDarkMode] = useState(false)
  const [title, setTitle] = useState('My Todo List')
  const [editingTitle, setEditingTitle] = useState(false)
  const [draggedItem, setDraggedItem] = useState(null)
  const [showMenu, setShowMenu] = useState(false)
  const [isCollapsing, setIsCollapsing] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  // Delete confirmation modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleteModalState, setDeleteModalState] = useState({ id: null, count: 0 })
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
  const isDropAnimatingRef = useRef(false) // Guard to avoid conflicting animations during drop
  const dragSessionIdRef = useRef(0) // Increments each drag start; used to ignore stale finalize callbacks
  const finalizeStartedRef = useRef(false) // Prevent duplicate finalize/updates
  const dropSessionIdRef = useRef(0) // Increments per drop; used to spam-proof cleanup
  const cleanupTimerRef = useRef(null) // Single active cleanup timer
  // Stable vertical dragging baseline
  const verticalStartMouseYRef = useRef(0)
  const verticalStartTopRef = useRef(0)
  const verticalFixedLeftRef = useRef(0)

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
    // Duration should match --stack-anim-duration in CSS (320ms) with a tiny buffer
    const DURATION = 320; // ms
    if (showMenu) {
      // Begin retract: keep expanded while we run the retract keyframes
      setIsCollapsing(true);
      // After animation, actually collapse
      window.clearTimeout(toggleMenu._t);
      toggleMenu._t = window.setTimeout(() => {
        setShowMenu(false);
        setIsCollapsing(false);
      }, DURATION + 20);
    } else {
      // Expand immediately
      setShowMenu(true);
    }
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

  // Modal handlers
  const handleCancelDelete = () => {
    setShowDeleteModal(false);
    setDeleteModalState({ id: null, count: 0 });
  };
  const handleConfirmCascade = async () => {
    const { id } = deleteModalState;
    setShowDeleteModal(false);
    await doDelete(id, true);
    setDeleteModalState({ id: null, count: 0 });
  };
  const handleConfirmLift = async () => {
    const { id } = deleteModalState;
    setShowDeleteModal(false);
    await doDelete(id, false);
    setDeleteModalState({ id: null, count: 0 });
  };

  // Internal helper to apply deletion and update local UI state
  const applyDeleteResult = (id, result) => {
    if (result && result.deletedIds && Array.isArray(result.deletedIds)) {
      const deletedIdSet = new Set(result.deletedIds.map(Number));
      let updatedTodos = todos.filter(todo => !deletedIdSet.has(Number(todo.id)));
      if (result.cascaded === false && Array.isArray(result.liftedIds) && result.liftedIds.length) {
        const lifted = new Set(result.liftedIds.map(Number));
        updatedTodos = updatedTodos.map(t => lifted.has(Number(t.id))
          ? { ...t, parentId: null, isIndented: false }
          : t
        );
      }
      updatedTodos = updatedTodos.map((t, idx) => ({ ...t, position: idx + 1 }));
      setTodos(updatedTodos);
    } else {
      // Fallback: delete only target; lift direct children
      console.warn('Delete response did not contain deletedIds, applying fallback');
      const targetId = Number(id);
      let updatedTodos = todos.filter(t => Number(t.id) !== targetId);
      updatedTodos = updatedTodos.map(t => Number(t.parentId) === targetId ? { ...t, parentId: null, isIndented: false } : t);
      updatedTodos = updatedTodos.map((t, idx) => ({ ...t, position: idx + 1 }));
      setTodos(updatedTodos);
    }
  };

  const doDelete = async (id, cascade) => {
    console.log('🔄 Calling db.deleteTodo...', { cascade });
    const result = await db.deleteTodo(Number(id), { cascade });
    console.log('✅ Delete result:', result);
    applyDeleteResult(id, result);
  };

  const deleteTodo = async (id) => {
    try {
      console.log(`🗑️ DELETE BUTTON CLICKED - Deleting todo with ID: ${id}`);
      console.log('Current todos before delete:', todos);
      
      // If we're deleting the item we're editing, stop editing
      if (Number(id) === editingId) {
        setEditingId(null);
      }
      
      // Determine if the todo has any descendants in current state
      const collectDescendants = (rootId) => {
        const result = new Set();
        const queue = [Number(rootId)];
        while (queue.length) {
          const pid = queue.shift();
          for (const t of todos) {
            const p = t.parentId ?? t.parent_id ?? null;
            if (Number(p) === pid) {
              const cid = Number(t.id);
              if (!result.has(cid)) {
                result.add(cid);
                queue.push(cid);
              }
            }
          }
        }
        return Array.from(result);
      };
      const descendantIds = collectDescendants(Number(id));
      const hasDescendants = descendantIds.length > 0;
      
      if (hasDescendants) {
        if (USE_CUSTOM_DELETE_MODAL) {
          setDeleteModalState({ id: Number(id), count: descendantIds.length });
          console.log('[modal] opening delete modal for id', id, 'with', descendantIds.length, 'children');
          setShowDeleteModal(true);
          return;
        } else {
          const cascade = window.confirm('This item has child tasks.\n\nOK: delete this item AND all its children.\nCancel: delete only this item and keep children (they will move to top level).');
          await doDelete(id, !!cascade);
          console.log('Todo deleted successfully');
          return;
        }
      }

      // No descendants: proceed with simple delete (cascade true by definition)
      await doDelete(id, true);
      
      console.log('Todo deleted successfully');
      
    } catch (error) {
      console.error('Error deleting todo:', error);
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
    
    // Get click position relative to the element box
    let x = e.clientX - rect.left;
    
    // Direct pixel-based approach - go character by character and find closest match
    let currentPosition = 0;
    let bestDistance = Infinity;
    let bestPosition = 0;
    
    // Get computed style to set canvas font
    const computedStyle = window.getComputedStyle(textElement);
    const ctx = canvasRef.current.getContext('2d');
    ctx.font = `${computedStyle.fontWeight} ${computedStyle.fontSize} ${computedStyle.fontFamily}`;
    ctx.textBaseline = 'top';
    
    // Determine where the rendered text actually starts inside the element box.
    // Accounts for text-align (left/center/right) and padding.
    const paddingLeft = parseFloat(computedStyle.paddingLeft) || 0;
    const paddingRight = parseFloat(computedStyle.paddingRight) || 0;
    const contentWidth = rect.width - paddingLeft - paddingRight;
    const fullTextWidth = ctx.measureText(text).width;
    let textStartX = paddingLeft; // default for left alignment
    const align = (computedStyle.textAlign || 'left').toLowerCase();
    if (align === 'center') {
      textStartX = paddingLeft + Math.max(0, (contentWidth - fullTextWidth) / 2);
    } else if (align === 'right' || align === 'end') {
      textStartX = Math.max(paddingLeft, rect.width - paddingRight - fullTextWidth);
    }
    
    // Convert click to be relative to the start of the text run
    x = x - textStartX;
    // Clamp within the text bounds so clicks in the empty area map to ends cleanly
    if (x < 0) x = 0;
    if (x > fullTextWidth) x = fullTextWidth;
    
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
    // New drag session tokens (invalidate any pending finalize/cleanup)
    dragSessionIdRef.current += 1;
    dropSessionIdRef.current += 1;
    if (cleanupTimerRef.current) { try { clearTimeout(cleanupTimerRef.current); } catch {} cleanupTimerRef.current = null; }
    // Clear any in-flight FLIP animations before starting a new drag
    document.querySelectorAll('.todo-item.anim-drop').forEach(el => {
      el.style.transition = '';
      el.style.transform = '';
      el.classList.remove('anim-drop');
    });
    // Force reflow to commit baseline
    void document.body.offsetHeight;
    
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
    
    // Ensure no stale placeholder remains from a prior aborted drag
    const existingPlaceholder = document.querySelector('.drag-placeholder');
    if (existingPlaceholder) existingPlaceholder.remove();
    
    // Add dragging class to body
    document.body.classList.add('is-dragging');
    document.body.style.userSelect = 'none';
    
    // Add dragging class to the dragged element
    if (draggedElementRef.current) {
      draggedElementRef.current.classList.add('dragging');
      draggedElementRef.current.style.zIndex = '1000';
      // Stabilize any in-flight transitions on the dragged element
      const cs = window.getComputedStyle(draggedElementRef.current);
      draggedElementRef.current.style.transition = 'none';
      if (cs.transform && cs.transform !== 'none') {
        draggedElementRef.current.style.transform = cs.transform;
        void draggedElementRef.current.offsetHeight; // lock current transform
      }
      
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
            // Establish stable baselines to avoid cumulative drift
            verticalStartMouseYRef.current = currentY;
            verticalStartTopRef.current = rect.top;
            const draggedItem0 = todos[draggedIndexRef.current];
            const isIndented0 = !!draggedItem0.isIndented;
            verticalFixedLeftRef.current = isIndented0 ? rect.left - 60 : rect.left;

            draggedElementRef.current.style.position = 'fixed';
            draggedElementRef.current.style.top = `${verticalStartTopRef.current}px`;
            draggedElementRef.current.style.left = `${verticalFixedLeftRef.current}px`;
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
        // Vertical movement based on fixed baselines (prevents drift)
        const delta = currentY - verticalStartMouseYRef.current;
        const newTop = verticalStartTopRef.current + delta;
        draggedElementRef.current.style.top = `${newTop}px`;
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
            // Skip FLIP animation on the dragged element if it will have its own slide animation
            const isDraggedElement = draggedElementRef.current && el === draggedElementRef.current;
            if (isDraggedElement) {
              return; // Let the slide animation handle the dragged element
            }
            
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
    
    // Keep placeholder in DOM until after any drop animation completes
    const placeholder = document.querySelector('.drag-placeholder');
    
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
    
    // If this was a horizontal drag, handle glide animation for indent/unindent and return early
    if (dragDirectionRef.current === 'horizontal' && draggedElementRef.current) {
      const el = draggedElementRef.current;
      const initialState = draggedItem.initialIndentationState || {
        isIndented: !!draggedItem.isIndented,
        parentId: draggedItem.parentId
      };

      const baseBefore = initialState.isIndented ? 60 : 0;
      const releaseOffset = baseBefore + (dragOffsetXRef.current || 0);

      // Decide target indentation
      const wasIndented = !!initialState.isIndented;
      let willBeIndented;
      if (wasIndented) {
        // If item was indented, unindent if dragged left more than 30px
        willBeIndented = (dragOffsetXRef.current || 0) > -30;
      } else {
        // If item was not indented, indent if dragged right more than 30px
        willBeIndented = (dragOffsetXRef.current || 0) > 30;
      }

      // Do not allow indenting the first item (no parent available)
      if (willBeIndented && draggedIndexRef.current === 0) {
        willBeIndented = false;
      }

      // Prepare animation start state (from release position)
      // Safety: clear any stale inline transform from previous animations
      el.style.transition = 'none';
      el.style.transform = '';
      el.style.transform = `translateX(${releaseOffset}px)`;

      // Stop tracking and clear listeners immediately
      isDraggingRef.current = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.classList.remove('is-dragging');
      el.classList.remove('dragging','dragging-horizontal','indent-preview');

      if (willBeIndented !== wasIndented) {
        // Commit indentation change to state, then glide to new base (0 or 60)
        // Pick the nearest previous NON-indented item as parent. If none, disallow indent.
        let targetParentId = null;
        if (willBeIndented) {
          const i = draggedIndexRef.current ?? -1;
          for (let j = (i !== null ? i - 1 : -1); j >= 0; j--) {
            const candidate = todos[j];
            if (!candidate) continue;
            if (!candidate.isIndented) {
              targetParentId = Number(candidate.id);
              break;
            }
          }
          // If no valid parent found, cancel indent
          if (targetParentId == null) {
            willBeIndented = false;
          }
        }

        const todosWithIndentChange = todos.map(t => 
          Number(t.id) === Number(draggedItem.id)
            ? { ...t, isIndented: willBeIndented, parentId: willBeIndented ? targetParentId : null }
            : t
        ).map((t, idx) => ({ ...t, position: idx + 1 }));

        const baseAfter = willBeIndented ? 60 : 0;

        // Trigger render; keep inline transform to hold visual position
        setTodos(todosWithIndentChange);

        const sessionAtStart = dragSessionIdRef.current;
        requestAnimationFrame(() => {
          void el.offsetHeight;
          const duration = prefersReducedMotion() ? 0 : DROP_DURATION_MS;
          if (duration === 0) {
            el.style.transition = 'none';
            el.style.transform = `translateX(${baseAfter}px)`;
          } else {
            el.style.transition = `transform ${duration}ms ${DROP_EASE}`;
            el.style.transform = `translateX(${baseAfter}px)`;
          }

          const finalize = () => {
            // Ignore if a new drag session has started
            if (sessionAtStart !== dragSessionIdRef.current) return;
            el.removeEventListener('transitionend', finalize);
            el.style.transition = '';
            el.style.transform = '';
            // Safety sweep: clear any lingering inline transforms across items
            document.querySelectorAll('.todo-item').forEach(n => { n.style.transform = ''; });
            // Defensive: clear any lingering flip-prep visibility-hiding classes
            document.querySelectorAll('.todo-item.flip-prep').forEach(n => { n.classList.remove('flip-prep'); });
            draggedIndexRef.current = null;
            targetIndexRef.current = null;
            draggedElementRef.current = null;
            dragDirectionRef.current = null;
            dragOffsetXRef.current = 0;
            dragThresholdPassed.current = false;
            setDraggedItem(null);
            db.updateTodoPositions(todosWithIndentChange)
              .catch(() => db.getAllTodos().then(serverTodos => setTodos(serverTodos)));
          };
          el.addEventListener('transitionend', finalize, { once: true });
          setTimeout(finalize, (prefersReducedMotion() ? 0 : DROP_DURATION_MS) + 80);
        });
      } else {
        // No indentation change; glide back to current base
        const baseAfter = baseBefore;
        const sessionAtStart = dragSessionIdRef.current;
        requestAnimationFrame(() => {
          void el.offsetHeight;
          const duration = prefersReducedMotion() ? 0 : DROP_DURATION_MS;
          if (duration === 0) {
            el.style.transition = 'none';
            el.style.transform = `translateX(${baseAfter}px)`;
          } else {
            el.style.transition = `transform ${duration}ms ${DROP_EASE}`;
            el.style.transform = `translateX(${baseAfter}px)`;
          }

          const finalize = () => {
            if (sessionAtStart !== dragSessionIdRef.current) return;
            el.removeEventListener('transitionend', finalize);
            el.style.transition = '';
            el.style.transform = '';
            // Defensive: clear any lingering flip-prep visibility-hiding classes
            document.querySelectorAll('.todo-item.flip-prep').forEach(n => { n.classList.remove('flip-prep'); });
            draggedIndexRef.current = null;
            targetIndexRef.current = null;
            draggedElementRef.current = null;
            dragDirectionRef.current = null;
            dragOffsetXRef.current = 0;
            dragThresholdPassed.current = false;
            setDraggedItem(null);
          };
          el.addEventListener('transitionend', finalize, { once: true });
          setTimeout(finalize, (prefersReducedMotion() ? 0 : DROP_DURATION_MS) + 60);
        });
      }

      return; // Horizontal path handled fully
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
      
      // Preserve indentation during vertical reorders among siblings.
      // Only unindent if moved to the very top; otherwise keep current parent/indent.
      if (insertAt === 0) {
        // If moved to the top, remove indentation
        movedItem.isIndented = false;
        movedItem.parentId = null;
      } else {
        // Do not force-unindent when previous item is also a child; keep existing parent.
        // The post-process step below will validate and, if needed, reattach to the nearest
        // previous non-indented item or unindent if none exists above.
      }
      
      // Insert the moved item at the new position
      updatedTodos.splice(insertAt, 0, movedItem);
      positionsChanged = true;
    }
    
    // Post-process: Fix any invalid parent-child relationships after reordering
    if (positionsChanged) {
      // Keep children indented by reparenting to the nearest previous root item.
      // Only unindent if there is NO non-indented item above.
      let relationshipsFixed = false;
      updatedTodos = updatedTodos.map((todo, index) => {
        if (!todo.isIndented) return todo;
        if (index === 0) {
          relationshipsFixed = true;
          return { ...todo, isIndented: false, parentId: null };
        }
        // Find nearest previous non-indented item
        let k = index - 1;
        let parent = null;
        while (k >= 0) {
          const cand = updatedTodos[k];
          if (!cand.isIndented) { parent = cand; break; }
          k--;
        }
        if (!parent) {
          relationshipsFixed = true;
          return { ...todo, isIndented: false, parentId: null };
        }
        const newPid = Number(parent.id);
        if (todo.parentId !== newPid) {
          relationshipsFixed = true;
          return { ...todo, parentId: newPid };
        }
        return todo;
      });
      if (relationshipsFixed) indentationChanged = true;
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
      
      // Detect children that auto-unindented on drop so we can animate them immediately
      const prevIndentById = new Map(todos.map(t => [Number(t.id), !!t.isIndented]));
      const unindentedIds = todosWithUpdatedPositions
        .filter(t => prevIndentById.get(Number(t.id)) === true && !t.isIndented)
        .map(t => Number(t.id));
      // SIMPLE FLIP ANIMATION ON REAL ELEMENT (no ghost)
      if (draggedElementRef.current) {
        const droppedId = draggedItem.id;
        const wasIndentedAtDrop = draggedElementRef.current.classList.contains('indented');
        // Pre-clear any lingering transforms/transitions before measuring
        document.querySelectorAll('.todo-item').forEach(el => {
          el.classList.remove('anim-drop');
          el.style.transition = '';
          el.style.transform = '';
        });
        // Force reflow to commit the clear so measurements are clean
        void document.body.offsetHeight;

        // Build affected ids: include all todo items to handle sibling shifts under spam
        const affectedIds = Array.from(document.querySelectorAll('.todo-item'))
          .map(el => el.getAttribute('data-id'))
          .filter(Boolean);
        // Snapshot BEFORE rects and indent state for affected ids
        const beforeRects = new Map();
        const beforeIndented = new Map();
        affectedIds.forEach(id => {
          const el = document.querySelector(`[data-id="${id}"]`);
          if (el) {
            beforeRects.set(String(id), el.getBoundingClientRect());
            beforeIndented.set(String(id), el.classList.contains('indented'));
          }
        });

        // Stop tracking immediately and clear any cursor-based/pinning styles on the dragged element
        isDraggingRef.current = false;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        setDraggedItem(null);
        // Clear inline styles that could keep it visually where the mouse left it
        draggedElementRef.current.style.transform = '';
        draggedElementRef.current.style.position = '';
        draggedElementRef.current.style.top = '';
        draggedElementRef.current.style.left = '';
        draggedElementRef.current.style.width = '';
        draggedElementRef.current.style.height = '';
        draggedElementRef.current.style.zIndex = '';
        draggedElementRef.current.style.pointerEvents = '';
        draggedElementRef.current.style.visibility = '';
        // Also drop drag classes now so layout is governed by normal CSS
        draggedElementRef.current.classList.remove('dragging','dragging-vertical','dragging-horizontal','indent-preview');

        // Reset finalize guard for this drop
        finalizeStartedRef.current = false;
        // Commit new order and remove placeholder so DOM settles
        setTodos(todosWithUpdatedPositions);
        if (placeholder) placeholder.remove();

        // After render, snapshot AFTER rects and apply unified FLIP animation
        const currentDropSession = ++dropSessionIdRef.current;
        if (cleanupTimerRef.current) { try { clearTimeout(cleanupTimerRef.current); } catch {} }
        // Hide only the dragged item for one frame to avoid duplicate flash
        const prepEl = document.querySelector(`[data-id="${droppedId}"]`);
        if (prepEl) prepEl.classList.add('flip-prep');
        // Double RAF to ensure React commit + layout settled before measuring AFTER rects
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            // Compute deltas and apply transforms
            affectedIds.forEach(id => {
              const el = document.querySelector(`[data-id="${id}"]`);
              const before = beforeRects.get(String(id));
              if (!el || !before) return;
              // Clear any pinning styles before measure
              el.style.position = '';
              el.style.top = '';
              el.style.left = '';
              el.style.width = '';
              el.style.height = '';
              el.style.zIndex = '';
              el.style.pointerEvents = '';
              el.style.visibility = '';
              const after = el.getBoundingClientRect();
              const dxMeasured = before.left - after.left;
              const dy = before.top - after.top;
              // Only allow horizontal animation for the dragged item when indent actually changed (e.g., auto-unindent at top)
              const isIndentedAfter = el.classList.contains('indented');
              const isDraggedEl = String(id) === String(droppedId);
              // Allow horizontal glide if indent state changed for either the dragged element
              // or any other element that auto-(un)indented as a result of the drop
              const wasIndentedBefore = beforeIndented.get(String(id));
              const allowDx = (isDraggedEl && (isIndentedAfter !== wasIndentedAtDrop)) || (!isDraggedEl && (wasIndentedBefore !== isIndentedAfter));
              const useDx = allowDx ? dxMeasured : 0;
              // Always unhide the dropped element even if no animation is needed
              if (isDraggedEl) el.classList.remove('flip-prep');
              if (Math.abs(useDx) < 0.5 && Math.abs(dy) < 0.5) return; // ignore subpixel noise
              el.classList.add('anim-drop');
              el.style.transition = 'none';
              // Compose with base indent so we don't momentarily drop horizontal offset
              const baseXAfter = isIndentedAfter ? 60 : 0; // must match CSS indent translateX
              el.style.transform = `translateX(${baseXAfter}px) translate(${useDx}px, ${dy}px)`;
              requestAnimationFrame(() => {
                void el.offsetHeight;
                el.style.transition = `transform ${DROP_DURATION_MS}ms ${DROP_EASE}`;
                // Transition back to base-only (keep indent), then cleanup timer will clear inline style
                el.style.transform = `translateX(${baseXAfter}px)`;
              });
            });

            // Schedule single cleanup for this drop
            cleanupTimerRef.current = setTimeout(() => {
              if (currentDropSession !== dropSessionIdRef.current) return; // stale
              document.querySelectorAll('.todo-item.anim-drop').forEach(el => {
                el.style.transition = '';
                el.style.transform = '';
                el.classList.remove('anim-drop');
                el.classList.remove('dragging','dragging-vertical','dragging-horizontal','indent-preview');
              });
              // Defensive: ensure no item remains hidden due to stale flip-prep
              document.querySelectorAll('.todo-item.flip-prep').forEach(el => {
                el.classList.remove('flip-prep');
              });
              isDropAnimatingRef.current = false;
              draggedIndexRef.current = null;
              targetIndexRef.current = null;
              draggedElementRef.current = null;
              dragDirectionRef.current = null;
              dragOffsetXRef.current = 0;
              dragThresholdPassed.current = false;
              document.body.classList.remove('is-dragging');
              document.body.style.userSelect = '';
              // Persist new positions
              db.updateTodoPositions(todosWithUpdatedPositions)
                .catch(() => db.getAllTodos().then(serverTodos => setTodos(serverTodos)));
            }, (prefersReducedMotion() ? 0 : DROP_DURATION_MS) + 100);
          });
        });
        return; // Done handling drop via FLIP
      }
      
      // APPROACH 1: Copy EXACT working structure from parent-child fix
      // Vertical slide animation - EXACT same pattern as working compensatingTransform
      if (!isDropAnimatingRef.current && dragDirectionRef.current === 'vertical' && positionsChanged && draggedElementRef.current) {
        // Store position before setTodos
        const beforeRect = draggedElementRef.current.getBoundingClientRect();
        
        // Wait one frame for setTodos to complete, then calculate and apply slide
        requestAnimationFrame(() => {
        if (draggedElementRef.current) {
          const afterRect = draggedElementRef.current.getBoundingClientRect();
          const slideDistance = beforeRect.top - afterRect.top;
            
            if (Math.abs(slideDistance) > 2) {
              // EXACT same structure as working parent-child fix
              draggedElementRef.current.style.transform = `translateY(${slideDistance}px)`;
              
              // Use shared DROP_DURATION_MS and DROP_EASE for drop-release animations
              // EXACT same requestAnimationFrame pattern
              requestAnimationFrame(() => {
                if (draggedElementRef.current) {
                  draggedElementRef.current.style.transition = `transform ${DROP_DURATION_MS}ms ${DROP_EASE}`;
                  draggedElementRef.current.style.transform = '';
                }
              });
            }
          }
        });
      }
      
      // Horizontal slide animation - EXACT same pattern as working compensatingTransform  
      if (dragDirectionRef.current === 'horizontal' && draggedElementRef.current) {
        const currentOffset = dragOffsetXRef.current;
        let horizontalSlideDistance = 0;
        
        // Calculate if user needs to slide the rest of the way
        if (indentationChanged) {
          const wasIndented = !!draggedItem.isIndented;
          if (!wasIndented && currentOffset < 60) {
            // Indenting but didn't go all the way
            horizontalSlideDistance = 60 - currentOffset;
          } else if (wasIndented && currentOffset > -60) {
            // Unindenting but didn't go all the way  
            horizontalSlideDistance = -(60 + currentOffset);
          }
        }
        
        if (Math.abs(horizontalSlideDistance) > 2) {
          // EXACT same structure as working parent-child fix
          draggedElementRef.current.style.transform = `translateX(${horizontalSlideDistance}px)`;
          
          // EXACT same requestAnimationFrame pattern
          requestAnimationFrame(() => {
            if (draggedElementRef.current) {
              draggedElementRef.current.style.transition = `transform ${DROP_DURATION_MS}ms ${DROP_EASE}`;
              draggedElementRef.current.style.transform = '';
            }
          });
        }
      }
      
      // Update UI state immediately (no overshoot animation needed)
      setTodos(todosWithUpdatedPositions);
      
      // APPROACH 2: Web Animations API as fallback (runs after setTodos)
      if (!isDropAnimatingRef.current && dragDirectionRef.current === 'vertical' && positionsChanged) {
        // Wait for React re-render, then find element and animate
        requestAnimationFrame(() => {
          const draggedItemId = draggedItem.id;
          const newElement = document.querySelector(`[data-id="${draggedItemId}"]`);
          
          if (newElement) {
            // Use Web Animations API for more reliable animation
            const animation = newElement.animate([
              { transform: 'translateY(20px)' }, // Start offset
              { transform: 'translateY(0px)' }   // End at natural position
            ], {
              duration: DROP_DURATION_MS,
              easing: DROP_EASE,
              fill: 'forwards'
            });
            
            animation.addEventListener('finish', () => {
              newElement.style.transform = '';
            });
          }
        });
      }
      
      // Apply compensating transform to prevent visual jump
      if (compensatingTransform !== 0 && draggedElementRef.current) {
        draggedElementRef.current.style.transform = `translateX(${compensatingTransform}px)`;
        
        // Remove the compensating transform after a brief moment to let it settle naturally
        requestAnimationFrame(() => {
          if (draggedElementRef.current) {
            draggedElementRef.current.style.transition = `transform ${DROP_DURATION_MS}ms ${DROP_EASE}`;
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
    document.body.style.userSelect = '';
    
    // Remove global event listeners
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  };

  if (isLoading) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <div className={`todo-app ${darkMode ? 'dark-mode' : ''}`}>
      <div className={`top-buttons ${showMenu ? 'expanded' : ''} ${isCollapsing ? 'collapsing' : ''}`}>
        <button className="menu-btn" aria-label="Menu" onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleMenu(); }}>
          <img 
            src="/images/menu_button.svg" 
            alt="Menu" 
            width="24" 
            height="24"
            className="menu-icon"
          />
        </button>
        <div className="stacked-actions">
          {/* Side stack (4 buttons): dark mode + 3 emoji */}
          <button className="dark-mode-btn side-btn side-1" onClick={toggleDarkMode} title={darkMode ? 'Light mode' : 'Dark mode'}>
            <img 
              src={darkMode ? "/images/lightmode.svg" : "/images/darkmode.svg"} 
              alt={darkMode ? "Switch to light mode" : "Switch to dark mode"} 
              width="24" 
              height="24"
              className="mode-icon"
            />
          </button>
          <button className="side-btn side-2" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }} title="Files">
            <img 
              src="/images/filefolder.svg" 
              alt="Files" 
              width="24" 
              height="24"
              className="icon"
            />
          </button>
          <button className="side-btn side-3" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }} title="Calendar">
            <img 
              src="/images/calandar_icon.svg" 
              alt="Calendar" 
              width="24" 
              height="24"
              className="icon"
            />
          </button>
          <button className="side-btn side-4" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }} title="Settings">
            <img 
              src="/images/gear.svg" 
              alt="Settings" 
              width="24" 
              height="24"
              className="icon"
            />
          </button>

          {/* Add button sits beneath the side stack */}
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
        </div>
      </div>

      {/* Fixed, full-width background under the title so tasks always scroll beneath */}
      <div className="header-fixed-bg" aria-hidden="true" />

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
            data-id={todo.id}
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

      {/* Visual cover to hide the native scrollbar without changing layout */}
      <div className="scrollbar-cover" aria-hidden="true" />

      {showDeleteModal && ReactDOM.createPortal(
        (
          <div className="modal-overlay" role="presentation" onClick={handleCancelDelete}>
            <div className="modal" role="dialog" aria-modal="true" aria-labelledby="del-title" onClick={(e) => e.stopPropagation()}>
              <h3 id="del-title">Delete task?</h3>
              <p>
                This task has {deleteModalState.count} {deleteModalState.count === 1 ? 'child' : 'children'}. Would you like to delete:
              </p>
              <div className="modal-actions">
                <button className="btn btn-icon danger btn-all" onClick={handleConfirmCascade} aria-label="Delete all" title="Delete all">
                  <img
                    src={darkMode ? "/images/deleteall_dark.svg" : "/images/deleteall_light.svg"}
                    alt=""
                    aria-hidden="true"
                  />
                </button>
                <button className="btn btn-icon btn-only" onClick={handleConfirmLift} aria-label="Delete only this" title="Delete only this">
                  <img
                    src={darkMode ? "/images/deletethisonly_dark.svg" : "/images/deletethisonly_light.svg"}
                    alt=""
                    aria-hidden="true"
                  />
                </button>
                <button className="btn btn-icon secondary btn-cancel" onClick={handleCancelDelete} aria-label="Cancel" title="Cancel">
                  <img
                    src={darkMode ? "/images/deletecancel_dark.svg" : "/images/deletecancel_light.svg"}
                    alt=""
                    aria-hidden="true"
                  />
                </button>
              </div>
            </div>
          </div>
        ),
        document.body
      )}
    </div>
  )
}

export default App
