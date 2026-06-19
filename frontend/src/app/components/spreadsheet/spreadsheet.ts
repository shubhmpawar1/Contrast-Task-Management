import { Component, OnInit, AfterViewInit, inject, ViewChild, ElementRef, AfterViewChecked, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SpreadsheetService, Sheet, SheetListItem, SheetCell, SheetData } from '../../services/spreadsheet.service.js';
import { Subject, debounceTime, switchMap } from 'rxjs';

@Component({
  selector: 'app-spreadsheet',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './spreadsheet.html',
  styleUrls: [] // We'll rely on Tailwind CSS classes
})
export class SpreadsheetComponent implements OnInit, AfterViewChecked, AfterViewInit {
  private service = inject(SpreadsheetService);

  // Sheets lists and active sheet data
  sheets: SheetListItem[] = [];
  activeSheet: Sheet | null = null;
  
  // Selection & Edit State
  activeCellKey: string = 'A1';
  isEditing: boolean = false;
  editingValue: string = '';
  
  // Tab renaming
  renameSheetId: number | null = null;
  renameSheetName: string = '';
  
  // Grid size
  rowCount = 100; // Total rows
  colCount = 52;  // Total columns (A to AZ)

  // Dynamic dimensions so the grid fills the viewport
  rowHeight = '28px';
  colWidth  = '100px';
  
  // Save status
  saveStatus: 'saved' | 'saving' | 'unsaved' = 'saved';
  private saveSubject = new Subject<void>();

  // Undo/Redo history states
  undoStack: string[] = [];
  redoStack: string[] = [];
  isTypingFormula = false;

  // Drag-to-fill state
  isDraggingFill = false;
  dragStartRow = -1;
  dragStartCol = -1;
  dragStartValue = '';
  dragCurrentRow = -1;
  dragCurrentCol = -1;

  // Multi-cell selection state
  isSelectingCells = false;
  selectionStartRow = -1;
  selectionStartCol = -1;
  selectionEndRow = -1;
  selectionEndCol = -1;

  // Custom column widths and row heights
  colWidths: { [key: number]: number } = {};
  rowHeights: { [key: number]: number } = {};

  // Drag resizing states
  isResizingCol = false;
  resizingColIdx = -1;
  isResizingRow = false;
  resizingRowIdx = -1;
  resizeStartX = 0;
  resizeStartY = 0;
  resizeStartSize = 0;

  // Cross-sheet linked dropdown state
  linkedDropdownOptions: { label: string; value: string }[] = [];
  linkedDropdownCell: string | null = null;  // e.g. 'B3' when dropdown is open
  linkedDropdownLoading = false;
  private linkedValuesCache = new Map<string, { label: string; value: string }[]>();

  // Colors list for toolbar dropdowns
  textColors = [
    { label: 'Black', class: 'text-black', hex: '#000000' },
    { label: 'Slate', class: 'text-slate-600', hex: '#475569' },
    { label: 'Blue', class: 'text-blue-600', hex: '#2563eb' },
    { label: 'Green', class: 'text-emerald-600', hex: '#059669' },
    { label: 'Red', class: 'text-red-600', hex: '#dc2626' },
    { label: 'Orange', class: 'text-orange-500', hex: '#f97316' },
    { label: 'Purple', class: 'text-purple-600', hex: '#9333ea' }
  ];

  bgColors = [
    { label: 'None', class: 'bg-transparent', hex: '' },
    { label: 'Slate', class: 'bg-slate-650', hex: '#475569' },
    { label: 'Blue', class: 'bg-blue-600', hex: '#2563eb' },
    { label: 'Green', class: 'bg-emerald-600', hex: '#10b981' },
    { label: 'Teal', class: 'bg-teal-600', hex: '#0d9488' },
    { label: 'Red', class: 'bg-rose-700', hex: '#be123c' },
    { label: 'Orange', class: 'bg-orange-500', hex: '#f97316' },
    { label: 'Yellow', class: 'bg-amber-500', hex: '#f59e0b' },
    { label: 'Purple', class: 'bg-purple-600', hex: '#8b5cf6' }
  ];

  @ViewChild('cellInput') cellInputEl?: ElementRef<HTMLInputElement>;
  @ViewChild('tabsContainer') tabsContainerEl?: ElementRef<HTMLElement>;
  @ViewChild('gridContainer') gridContainerEl?: ElementRef<HTMLElement>;
  private focusNeeded = false;

  ngOnInit() {
    this.loadSheetsList(true);
    this.updateDimensions();

    // Setup auto-save behavior debounced by 1 second
    this.saveSubject.pipe(
      debounceTime(1000)
    ).subscribe(() => {
      this.saveActiveSheet();
    });
  }

  /** Recalculate cell dimensions so the rows and columns fit the visible grid exactly */
  private updateDimensions() {
    if (this.gridContainerEl) {
      const el = this.gridContainerEl.nativeElement;

      // ── Row height ──────────────────────────────────────────────
      // We want exactly 32 data rows to fit in the container height.
      // colHeader row = h-8(32px) + border-b(1px) = 33px.
      // We also account for the border-b on the 32 data rows (32px).
      const gridHeight = el.clientHeight;
      const visibleRows = 32;
      this.rowHeight = `${Math.max(18, Math.floor((gridHeight - 33 - visibleRows) / visibleRows))}px`;

      // ── Column width ─────────────────────────────────────────────
      // We want exactly 26 columns (A to Z) to fit in the container width.
      // row-number sticky col = w-12 (48px) + its right border (1px) = 49px.
      // We also account for the border-r on the 26 columns (26px).
      const gridWidth = el.clientWidth;
      const visibleCols = 26;
      this.colWidth = `${Math.max(60, Math.floor((gridWidth - 49 - visibleCols) / visibleCols))}px`;
    } else {
      // Fallback before DOM is ready
      const availH = window.innerHeight - 251;
      this.rowHeight = `${Math.max(18, Math.floor(availH / 32))}px`;
      const availW = window.innerWidth - 49 - 26;
      this.colWidth  = `${Math.max(60, Math.floor(availW / 26))}px`;
    }
  }

  @HostListener('window:resize')
  onWindowResize() {
    this.updateDimensions();
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyboardNavigation(event: KeyboardEvent) {
    const isCmdOrCtrl = event.ctrlKey || event.metaKey;

    // Handle Ctrl+Z / Cmd+Z (Undo) — always, even if editing
    if (isCmdOrCtrl && event.key === 'z' && !event.shiftKey) {
      const activeEl = document.activeElement;
      // Only if not typing in formula bar / rename input
      if (!(activeEl && activeEl.id === 'formulaBarInput') && !this.isEditing) {
        event.preventDefault();
        this.undo();
        return;
      }
    }

    // Handle Ctrl+Y / Cmd+Y or Ctrl+Shift+Z / Cmd+Shift+Z (Redo)
    if ((isCmdOrCtrl && event.key === 'y') || (isCmdOrCtrl && event.shiftKey && event.key === 'z')) {
      const activeEl = document.activeElement;
      if (!(activeEl && activeEl.id === 'formulaBarInput') && !this.isEditing) {
        event.preventDefault();
        this.redo();
        return;
      }
    }

    // If editing a cell, handle key events in onCellInputKeyDown
    if (this.isEditing) {
      return;
    }

    // Ignore keyboard navigation if the user is typing in inputs (formula bar, sheet rename, etc.)
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
      return;
    }

    // Delete or Backspace: clear the active cell
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      this.deleteActiveCell();
      return;
    }

    // Keys we care about for grid navigation
    const navKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'];
    if (!navKeys.includes(event.key)) {
      return;
    }

    const match = this.activeCellKey.match(/^([A-Z]+)(\d+)$/);
    if (!match) return;

    const colLabel = match[1];
    const row = parseInt(match[2], 10);
    const colIndex = this.getColIndexFromLabel(colLabel);

    let newRow = row;
    let newColIndex = colIndex;

    switch (event.key) {
      case 'ArrowUp':
        newRow = Math.max(1, row - 1);
        break;
      case 'ArrowDown':
        newRow = Math.min(this.rowCount, row + 1);
        break;
      case 'ArrowLeft':
        newColIndex = Math.max(0, colIndex - 1);
        break;
      case 'ArrowRight':
        newColIndex = Math.min(this.colCount - 1, colIndex + 1);
        break;
      case 'Tab':
        if (event.shiftKey) {
          newColIndex = Math.max(0, colIndex - 1);
        } else {
          newColIndex = Math.min(this.colCount - 1, colIndex + 1);
        }
        break;
    }

    if (newRow !== row || newColIndex !== colIndex) {
      event.preventDefault();
      this.selectCell(newRow, newColIndex);
    }
  }

  ngAfterViewInit() {
    // Measure actual grid dimensions after DOM is ready
    this.updateDimensions();
  }

  ngAfterViewChecked() {
    if (this.focusNeeded && this.cellInputEl) {
      this.cellInputEl.nativeElement.focus();
      this.cellInputEl.nativeElement.select();
      this.focusNeeded = false;
    }
  }

  // Fetch all sheets from server
  loadSheetsList(loadFirst: boolean = false) {
    this.service.getSheets().subscribe({
      next: (data) => {
        this.sheets = data;
        if (loadFirst && data.length > 0) {
          this.selectSheet(data[0].id);
        }
      },
      error: (err) => console.error('Error listing sheets:', err)
    });
  }

  // Load and display a single sheet
  selectSheet(id: number) {
    // If there are unsaved changes, save them immediately first
    if (this.saveStatus === 'unsaved' && this.activeSheet) {
      this.saveActiveSheet();
    }

    this.service.getSheet(id).subscribe({
      next: (sheet) => {
        this.activeSheet = sheet;
        this.rowCount = sheet.data.rows || 100;
        this.colCount = sheet.data.cols || 52;
        this.colWidths = sheet.data.colWidths || {};
        this.rowHeights = sheet.data.rowHeights || {};
        this.activeCellKey = 'A1';
        this.isEditing = false;
        
        // Sync formula bar value
        const cell = this.activeSheet.data.cells[this.activeCellKey];
        this.editingValue = cell ? cell.value : '';
        this.saveStatus = 'saved';
      },
      error: (err) => console.error(`Error loading sheet ${id}:`, err)
    });
  }

  // Create a new sheet
  addSheet() {
    this.service.createSheet().subscribe({
      next: (newSheet) => {
        this.sheets.push({
          id: newSheet.id,
          name: newSheet.name,
          table_name: newSheet.table_name,
          updated_at: newSheet.updated_at
        });
        this.selectSheet(newSheet.id);
        // Scroll the tabs bar to the end so the new tab is visible
        setTimeout(() => {
          if (this.tabsContainerEl) {
            this.tabsContainerEl.nativeElement.scrollLeft =
              this.tabsContainerEl.nativeElement.scrollWidth;
          }
        }, 50);
      },
      error: (err) => console.error('Error adding sheet:', err)
    });
  }

  // Delete a sheet
  deleteSheet(id: number, event: MouseEvent) {
    event.stopPropagation(); // Avoid switching sheet active state when clicking delete
    
    if (this.sheets.length <= 1) {
      alert('You must keep at least one sheet.');
      return;
    }

    if (confirm('Are you sure you want to delete this sheet?')) {
      this.service.deleteSheet(id).subscribe({
        next: () => {
          const index = this.sheets.findIndex(s => s.id === id);
          this.sheets = this.sheets.filter(s => s.id !== id);
          
          // If deleted sheet was active, select another
          if (this.activeSheet && this.activeSheet.id === id) {
            const nextActiveId = this.sheets[Math.max(0, index - 1)].id;
            this.selectSheet(nextActiveId);
          }
        },
        error: (err) => console.error(`Error deleting sheet ${id}:`, err)
      });
    }
  }

  // Enable tab rename mode
  startRenameSheet(id: number, currentName: string, event: MouseEvent) {
    event.stopPropagation();
    this.renameSheetId = id;
    this.renameSheetName = currentName;
  }

  // Complete rename and save to backend
  finishRenameSheet() {
    if (!this.renameSheetId) return;
    const trimmed = this.renameSheetName.trim();
    if (!trimmed) {
      this.renameSheetId = null;
      return;
    }

    const targetId = this.renameSheetId;
    this.service.updateSheet(targetId, { name: trimmed }).subscribe({
      next: (updated) => {
        // Update list
        const listItem = this.sheets.find(s => s.id === targetId);
        if (listItem) listItem.name = updated.name;
        
        // Update active sheet object if active
        if (this.activeSheet && this.activeSheet.id === targetId) {
          this.activeSheet.name = updated.name;
        }
        
        this.renameSheetId = null;
      },
      error: (err) => {
        console.error('Error renaming sheet:', err);
        this.renameSheetId = null;
      }
    });
  }

  // Save the current state to backend
  saveActiveSheet() {
    if (!this.activeSheet) return;
    this.saveStatus = 'saving';
    
    const updatePayload = {
      name: this.activeSheet.name,
      data: {
        rows: this.rowCount,
        cols: this.colCount,
        colWidths: this.colWidths,
        rowHeights: this.rowHeights,
        cells: this.activeSheet.data.cells
      }
    };

    this.service.updateSheet(this.activeSheet.id, updatePayload).subscribe({
      next: () => {
        this.saveStatus = 'saved';
      },
      error: (err) => {
        console.error('Error auto-saving sheet:', err);
        this.saveStatus = 'unsaved'; // Revert status
      }
    });
  }

  // Snapshot the current cells state for undo/redo history
  pushHistory() {
    if (!this.activeSheet) return;
    const snapshot = JSON.stringify(this.activeSheet.data.cells);
    this.undoStack.push(snapshot);
    // Limit history to 100 steps to avoid memory bloat
    if (this.undoStack.length > 100) this.undoStack.shift();
    // Clear redo stack whenever a new action is made
    this.redoStack = [];
  }

  /** Undo last cell change (Ctrl+Z) */
  undo() {
    if (!this.activeSheet || !this.undoStack.length) return;
    // Save current state to redo stack before reverting
    this.redoStack.push(JSON.stringify(this.activeSheet.data.cells));
    const prev = this.undoStack.pop()!;
    this.activeSheet.data.cells = JSON.parse(prev);
    // Sync the formula bar
    const cell = this.activeSheet.data.cells[this.activeCellKey];
    this.editingValue = cell ? cell.value : '';
    this.saveStatus = 'unsaved';
    this.saveSubject.next();
  }

  /** Redo last undone cell change (Ctrl+Y or Ctrl+Shift+Z) */
  redo() {
    if (!this.activeSheet || !this.redoStack.length) return;
    // Save current state to undo stack
    this.undoStack.push(JSON.stringify(this.activeSheet.data.cells));
    const next = this.redoStack.pop()!;
    this.activeSheet.data.cells = JSON.parse(next);
    // Sync the formula bar
    const cell = this.activeSheet.data.cells[this.activeCellKey];
    this.editingValue = cell ? cell.value : '';
    this.saveStatus = 'unsaved';
    this.saveSubject.next();
  }

  /** Delete the content of the currently selected cell range */
  deleteActiveCell() {
    if (!this.activeSheet) return;

    let minRow = this.selectionStartRow;
    let maxRow = this.selectionEndRow;
    let minCol = this.selectionStartCol;
    let maxCol = this.selectionEndCol;

    if (minRow === -1 || minCol === -1) {
      const match = this.activeCellKey.match(/^([A-Z]+)(\d+)$/);
      if (!match) return;
      minRow = maxRow = parseInt(match[2], 10);
      minCol = maxCol = this.getColIndexFromLabel(match[1]);
    }

    const startRow = Math.min(minRow, maxRow);
    const endRow = Math.max(minRow, maxRow);
    const startCol = Math.min(minCol, maxCol);
    const endCol = Math.max(minCol, maxCol);

    this.pushHistory();

    const cells = this.activeSheet.data.cells;
    let cellsChanged = false;

    for (let r = startRow; r <= endRow; r++) {
      for (let c = startCol; c <= endCol; c++) {
        const colLabel = this.getColLabel(c);
        const cellKey = `${colLabel}${r}`;
        const cell = cells[cellKey];
        if (cell && cell.value !== '') {
          cell.value = '';
          cellsChanged = true;
        }
      }
    }

    if (cellsChanged) {
      this.editingValue = '';
      this.triggerChange();
    }
  }

  // Mark changes, schedule auto-save
  triggerChange() {
    this.saveStatus = 'unsaved';
    this.saveSubject.next();
  }

  // Convert column index to labels (0 -> A, 1 -> B, etc.)
  getColLabel(index: number): string {
    let label = '';
    let temp = index;
    while (temp >= 0) {
      label = String.fromCharCode((temp % 26) + 65) + label;
      temp = Math.floor(temp / 26) - 1;
    }
    return label;
  }

  // Generate lists of row numbers and column labels for the HTML view
  getRows(): number[] {
    return Array.from({ length: this.rowCount }, (_, i) => i + 1);
  }

  getCols(): number[] {
    return Array.from({ length: this.colCount }, (_, i) => i);
  }

  /** True when the currently selected cell is in Row 1 (the header/column-definition row) */
  get isHeaderRow(): boolean {
    const match = this.activeCellKey.match(/^[A-Z]+(\d+)$/);
    return match ? parseInt(match[1], 10) === 1 : false;
  }

  // Cell Selection and Editing
  selectCell(row: number, colIndex: number) {
    if (this.isEditing) {
      this.closeCellEdit();
    }

    const colLabel = this.getColLabel(colIndex);
    this.activeCellKey = `${colLabel}${row}`;

    // Reset formula-bar typing session flag
    this.isTypingFormula = false;

    // Sync editor input
    const cell = this.activeSheet?.data.cells[this.activeCellKey];
    this.editingValue = cell ? cell.value : '';

    // Sync selection range to single active cell
    this.selectionStartRow = row;
    this.selectionStartCol = colIndex;
    this.selectionEndRow = row;
    this.selectionEndCol = colIndex;

    // Check if this column is linked to another sheet (row > 1 only)
    this.linkedDropdownCell = null;
    this.linkedDropdownOptions = [];
    if (row > 1) {
      this.checkLinkedColumn(row, colIndex, colLabel);
    }
  }

  /** Check if this column's header (Row 1) matches a sheet tab name → load dropdown */
  private checkLinkedColumn(row: number, colIndex: number, colLabel: string) {
    if (!this.activeSheet) return;

    // Get the header value for this column (Row 1 cell)
    const headerKey = `${colLabel}1`;
    const headerCell = this.activeSheet.data.cells[headerKey];
    const headerValue = headerCell?.value?.trim().toLowerCase() || '';
    if (!headerValue) return;

    // Find a sheet whose name or table_name matches this header
    const linkedSheet = this.sheets.find(s =>
      s.name.toLowerCase() === headerValue ||
      s.table_name?.toLowerCase() === headerValue
    );
    if (!linkedSheet?.table_name) return;

    const tableName = linkedSheet.table_name;

    // Use cache if available — avoid hammering the API
    if (this.linkedValuesCache.has(tableName)) {
      this.linkedDropdownCell = this.activeCellKey;
      this.linkedDropdownOptions = this.linkedValuesCache.get(tableName)!;
      return;
    }

    // Load values from that sheet's real table
    this.linkedDropdownLoading = true;
    this.linkedDropdownCell = this.activeCellKey;
    this.service.getTableValues(tableName).subscribe({
      next: (result) => {
        this.linkedDropdownLoading = false;
        if (!result.columns.length) return;

        // Use the first column's values as dropdown options
        const firstCol = result.columns[0];
        const options = result.rows
          .map(r => r[firstCol])
          .filter(v => v && v.trim())
          .map(v => ({ label: v, value: v }));

        this.linkedValuesCache.set(tableName, options);
        this.linkedDropdownOptions = options;
      },
      error: () => { this.linkedDropdownLoading = false; }
    });
  }

  /** Helper to check if a value is selected in the active linked cell */
  isOptionSelected(value: string): boolean {
    if (!this.activeSheet || !this.linkedDropdownCell) return false;
    const cellValue = this.activeSheet.data.cells[this.linkedDropdownCell]?.value || '';
    if (!cellValue.trim()) return false;
    const selected = cellValue.split(',').map(v => v.trim().toLowerCase());
    return selected.includes(value.trim().toLowerCase());
  }

  /** Called when user toggles a checkbox value in the linked dropdown */
  toggleLinkedValue(value: string) {
    if (!this.activeSheet || !this.linkedDropdownCell) return;
    const cells = this.activeSheet.data.cells;
    const currentVal = cells[this.linkedDropdownCell]?.value || '';
    
    let selected = currentVal ? currentVal.split(',').map(v => v.trim()) : [];
    const index = selected.findIndex(v => v.toLowerCase() === value.trim().toLowerCase());

    if (index > -1) {
      // Remove value if already selected
      selected.splice(index, 1);
    } else {
      // Add value if not selected
      selected.push(value.trim());
    }

    // Filter out any empty selections and join with comma
    const newValue = selected.filter(v => v.trim()).join(', ');

    cells[this.linkedDropdownCell] = { ...(cells[this.linkedDropdownCell] || {}), value: newValue };
    this.editingValue = newValue;
    
    this.handleAutoLookup(this.linkedDropdownCell, newValue);
    this.triggerChange(); // Mark unsaved and trigger debounced save
  }

  /** Close the active linked dropdown */
  closeLinkedDropdown() {
    this.linkedDropdownCell = null;
    this.linkedDropdownOptions = [];
  }

  /** Perform auto-lookup to sync relationships dynamically between tabs */
  private handleAutoLookup(cellKey: string, value: string) {
    if (!this.activeSheet || !value) return;

    const match = cellKey.match(/^([A-Z]+)(\d+)$/);
    if (!match) return;

    const colLabel = match[1];
    const rowNum = parseInt(match[2], 10);

    // Get the header name of the column that was edited
    const editedHeaderKey = `${colLabel}1`;
    const editedHeaderCell = this.activeSheet.data.cells[editedHeaderKey];
    const editedHeaderValue = editedHeaderCell?.value?.trim().toLowerCase() || '';
    if (!editedHeaderValue) return;

    // Check if this header matches a sheet tab/table name (meaning it's a relation column)
    const linkedSheet = this.sheets.find(s =>
      s.name.toLowerCase() === editedHeaderValue ||
      s.table_name?.toLowerCase() === editedHeaderValue
    );
    if (!linkedSheet?.table_name) return;

    const tableName = linkedSheet.table_name;

    // Whitelist of columns allowed to be auto-populated based on the relation source:
    // [editedHeaderName] -> [allowed target column names in database format]
    const allowedFieldsMap: Record<string, string[]> = {
      'module': ['project', 'users', 'ui_status', 'integration_status'],
      'project': ['description', 'start_date'],
      'users': ['role', 'email'],
      'task': ['module', 'users']
    };

    // Reverse lookup map: when a relation column is set, also look up related child tables.
    // Supports arrays: multiple reverse lookups per source column.
    // cascadeFields: extra fields from the found child row to also fill in the current row.
    const reverseLookupMap: Record<string, Array<{
      childTable: string;
      childLinkField: string;
      childFirstCol: string;
      cascadeFields?: string[];
    }>> = {
      // selecting module → find task where task.module = selected module → fill task column
      'module': [
        { childTable: 'task', childLinkField: 'module', childFirstCol: 'task_name' }
      ],
      // selecting user → find module where module.users = selected user → fill module + cascade project/status
      //               → find task where task.users = selected user → fill task column
      'users': [
        {
          childTable: 'module',
          childLinkField: 'users',
          childFirstCol: 'module_name',
          cascadeFields: ['project', 'ui_status', 'integration_status']
        },
        { childTable: 'task', childLinkField: 'users', childFirstCol: 'task_name' }
      ]
    };

    // Process all reverse lookups for this column header
    const reverseLookups = reverseLookupMap[editedHeaderValue] || [];
    for (const rl of reverseLookups) {
      this.service.getTableValues(rl.childTable).subscribe({
        next: (childResult) => {
          if (!childResult.columns.length || !childResult.rows.length) return;

          // Find the child row where the link field matches the selected value
          const childRow = childResult.rows.find(r =>
            r[rl.childLinkField]?.trim().toLowerCase() === value.trim().toLowerCase()
          );
          if (!childRow) return;

          const cells = this.activeSheet!.data.cells;

          // Fill the direct child column (e.g. 'module' or 'task' header in dashboard)
          for (let c = 0; c < this.colCount; c++) {
            const targetColLabel = this.getColLabel(c);
            if (targetColLabel === colLabel) continue;
            const targetHeaderKey = `${targetColLabel}1`;
            const targetHeader = this.activeSheet!.data.cells[targetHeaderKey]?.value?.trim().toLowerCase() || '';
            if (targetHeader === rl.childTable) {
              const newVal = childRow[rl.childFirstCol] || '';
              if (newVal) {
                const cellAddress = `${targetColLabel}${rowNum}`;
                cells[cellAddress] = { ...(cells[cellAddress] || {}), value: newVal };
              }
              break;
            }
          }

          // Cascade: also fill extra fields from the found child row into matching dashboard columns
          if (rl.cascadeFields?.length) {
            for (let c = 0; c < this.colCount; c++) {
              const targetColLabel = this.getColLabel(c);
              if (targetColLabel === colLabel) continue;
              const targetHeaderKey = `${targetColLabel}1`;
              const targetHeader = this.activeSheet!.data.cells[targetHeaderKey]?.value?.trim().toLowerCase() || '';
              if (!targetHeader) continue;
              const dbFieldName = this.sanitizeHeaderToFieldName(targetHeader);
              if (rl.cascadeFields!.includes(dbFieldName)) {
                const cascadeVal = childRow[dbFieldName];
                if (cascadeVal !== undefined && cascadeVal !== null && cascadeVal !== '') {
                  const cellAddress = `${targetColLabel}${rowNum}`;
                  cells[cellAddress] = { ...(cells[cellAddress] || {}), value: cascadeVal };
                }
              }
            }
          }

          this.triggerChange();
        }
      });
    }

    const allowedFields = allowedFieldsMap[editedHeaderValue] || [];
    if (!allowedFields.length) return;

    // Fetch the target table values
    this.service.getTableValues(tableName).subscribe({
      next: (result) => {
        if (!result.columns.length || !result.rows.length) return;

        // Find the row where the first column's value matches the selected value
        const firstCol = result.columns[0];
        const matchedRow = result.rows.find(r =>
          r[firstCol]?.trim().toLowerCase() === value.trim().toLowerCase()
        );
        if (!matchedRow) return;

        const cells = this.activeSheet!.data.cells;

        // Iterate through all columns in the CURRENT sheet
        for (let c = 0; c < this.colCount; c++) {
          const targetColLabel = this.getColLabel(c);
          // Don't overwrite the cell that the user just edited!
          if (targetColLabel === colLabel) continue;

          const targetHeaderKey = `${targetColLabel}1`;
          const targetHeaderCell = this.activeSheet!.data.cells[targetHeaderKey];
          const targetHeaderValue = targetHeaderCell?.value?.trim().toLowerCase() || '';
          if (!targetHeaderValue) continue;

          // Convert target header value to standard database format (e.g. "UI Status" -> "ui_status")
          const dbFieldName = this.sanitizeHeaderToFieldName(targetHeaderValue);

          // ONLY populate if the field is in our whitelist for this relation!
          if (!allowedFields.includes(dbFieldName)) continue;

          // If the matched relation row contains a value for this field, auto-populate it!
          if (matchedRow[dbFieldName] !== undefined && matchedRow[dbFieldName] !== null) {
            const cellAddress = `${targetColLabel}${rowNum}`;
            const oldVal = cells[cellAddress]?.value || '';
            const newVal = matchedRow[dbFieldName];
            
            // Only update and cascade if the value has changed
            if (oldVal !== newVal) {
              cells[cellAddress] = {
                ...(cells[cellAddress] || {}),
                value: newVal
              };
              // RECURSIVELY TRIGGER AUTO-LOOKUP FOR THE NEWLY POPULATED CELL!
              this.handleAutoLookup(cellAddress, newVal);
            }
          }
        }

        // Sync the formula bar display value if focused on an auto-populated cell
        const activeCellLabel = this.activeCellKey;
        const currentCell = cells[activeCellLabel];
        this.editingValue = currentCell ? currentCell.value : '';

        this.triggerChange();
      }
    });
  }

  /** Helper to sanitize header text to match Postgres column names. e.g. "UI Status" -> "ui_status" */
  private sanitizeHeaderToFieldName(h: string): string {
    return h.toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '')
      .replace(/^_+|_+$/g, '')
      .replace(/_+/g, '_')
      .replace(/^(\d)/, 'col_$1');
  }

  doubleClickCell(row: number, colIndex: number) {
    this.selectCell(row, colIndex);
    this.isEditing = true;
    this.focusNeeded = true;
  }

  onCellInputBlur() {
    this.closeCellEdit();
  }

  onCellInputKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      this.closeCellEdit();
      // Move to next row cell if possible
      const match = this.activeCellKey.match(/^([A-Z]+)(\d+)$/);
      if (match) {
        const col = match[1];
        const row = parseInt(match[2], 10);
        if (row < this.rowCount) {
          const colIndex = this.getColIndexFromLabel(col);
          this.selectCell(row + 1, colIndex);
        }
      }
    } else if (event.key === 'Tab') {
      event.preventDefault();
      this.closeCellEdit();
      const match = this.activeCellKey.match(/^([A-Z]+)(\d+)$/);
      if (match) {
        const col = match[1];
        const row = parseInt(match[2], 10);
        const colIndex = this.getColIndexFromLabel(col);
        if (event.shiftKey) {
          if (colIndex > 0) {
            this.selectCell(row, colIndex - 1);
          }
        } else {
          if (colIndex < this.colCount - 1) {
            this.selectCell(row, colIndex + 1);
          }
        }
      }
    } else if (event.key === 'Escape') {
      // Revert edits
      const cell = this.activeSheet?.data.cells[this.activeCellKey];
      this.editingValue = cell ? cell.value : '';
      this.isEditing = false;
    }
  }

  private getColIndexFromLabel(label: string): number {
    let index = 0;
    for (let i = 0; i < label.length; i++) {
      index = index * 26 + (label.charCodeAt(i) - 64);
    }
    return index - 1;
  }

  closeCellEdit() {
    if (!this.activeSheet) return;
    this.isEditing = false;
    
    const cells = this.activeSheet.data.cells;
    const currentCell = cells[this.activeCellKey];
    const newValue = this.editingValue;

    if (!currentCell) {
      if (newValue.trim() !== '') {
        this.pushHistory();
        cells[this.activeCellKey] = { value: newValue };
        this.handleAutoLookup(this.activeCellKey, newValue);
        this.triggerChange();
      }
    } else {
      if (currentCell.value !== newValue) {
        this.pushHistory();
        currentCell.value = newValue;
        this.handleAutoLookup(this.activeCellKey, newValue);
        this.triggerChange();
      }
    }
  }

  // Update cell value from Formula Bar directly
  onFormulaBarChange() {
    if (!this.activeSheet) return;
    
    const cells = this.activeSheet.data.cells;
    const currentCell = cells[this.activeCellKey];
    const newValue = this.editingValue;

    // Push history only once per formula-bar editing session
    if (!this.isTypingFormula) {
      this.pushHistory();
      this.isTypingFormula = true;
    }

    if (!currentCell) {
      if (newValue.trim() !== '') {
        cells[this.activeCellKey] = { value: newValue };
        this.handleAutoLookup(this.activeCellKey, newValue);
        this.triggerChange();
      }
    } else {
      currentCell.value = newValue;
      this.handleAutoLookup(this.activeCellKey, newValue);
      this.triggerChange();
    }
  }

  // Formatting tools
  toggleBold() {
    this.updateCellFormatting(cell => {
      cell.bold = !cell.bold;
    });
  }

  toggleItalic() {
    this.updateCellFormatting(cell => {
      cell.italic = !cell.italic;
    });
  }

  setTextColor(colorHex: string) {
    this.updateCellFormatting(cell => {
      cell.color = colorHex;
    });
  }

  setBgColor(bgHex: string) {
    this.updateCellFormatting(cell => {
      cell.bg = bgHex;
    });
  }

  private updateCellFormatting(formatFn: (cell: SheetCell) => void) {
    if (!this.activeSheet) return;

    let minRow = this.selectionStartRow;
    let maxRow = this.selectionEndRow;
    let minCol = this.selectionStartCol;
    let maxCol = this.selectionEndCol;

    if (minRow === -1 || minCol === -1) {
      const match = this.activeCellKey.match(/^([A-Z]+)(\d+)$/);
      if (!match) return;
      minRow = maxRow = parseInt(match[2], 10);
      minCol = maxCol = this.getColIndexFromLabel(match[1]);
    }

    const startRow = Math.min(minRow, maxRow);
    const endRow = Math.max(minRow, maxRow);
    const startCol = Math.min(minCol, maxCol);
    const endCol = Math.max(minCol, maxCol);

    this.pushHistory();

    const cells = this.activeSheet.data.cells;
    for (let r = startRow; r <= endRow; r++) {
      for (let c = startCol; c <= endCol; c++) {
        const colLabel = this.getColLabel(c);
        const cellKey = `${colLabel}${r}`;
        let cell = cells[cellKey];
        if (!cell) {
          cell = { value: '' };
          cells[cellKey] = cell;
        }
        formatFn(cell);
      }
    }

    this.triggerChange();
  }

  // Cell Styles Getter
  getCellStyles(row: number, colIndex: number): { [key: string]: string } {
    const colLabel = this.getColLabel(colIndex);
    const key = `${colLabel}${row}`;
    const cell = this.activeSheet?.data.cells[key];
    
    if (!cell) return {};

    const styles: { [key: string]: string } = {};
    if (cell.bold) styles['font-weight'] = 'bold';
    if (cell.italic) styles['font-style'] = 'italic';
    if (cell.color) styles['color'] = cell.color;
    if (cell.bg) styles['background-color'] = cell.bg;

    return styles;
  }

  getColWidth(colIdx: number): string {
    const w = this.colWidths[colIdx];
    return w ? `${w}px` : this.colWidth;
  }

  getRowHeight(row: number): string {
    const h = this.rowHeights[row];
    return h ? `${h}px` : this.rowHeight;
  }

  startColResize(event: MouseEvent, colIdx: number) {
    event.stopPropagation();
    event.preventDefault();
    this.isResizingCol = true;
    this.resizingColIdx = colIdx;
    this.resizeStartX = event.clientX;
    const currentWidthStr = this.getColWidth(colIdx);
    this.resizeStartSize = parseInt(currentWidthStr, 10);
  }

  startRowResize(event: MouseEvent, row: number) {
    event.stopPropagation();
    event.preventDefault();
    this.isResizingRow = true;
    this.resizingRowIdx = row;
    this.resizeStartY = event.clientY;
    const currentHeightStr = this.getRowHeight(row);
    this.resizeStartSize = parseInt(currentHeightStr, 10);
  }

  // Grid resizing
  addRow() {
    this.rowCount++;
    this.triggerChange();
  }

  addColumn() {
    this.colCount++;
    this.triggerChange();
  }

  // Selection and Drag-to-fill handlers
  onCellMouseDown(event: MouseEvent, row: number, colIndex: number) {
    if (event.button !== 0) return; // Left click only
    this.isSelectingCells = true;
    this.selectCell(row, colIndex);
  }

  onRowHeaderMouseDown(event: MouseEvent, row: number) {
    if (event.button !== 0) return;
    if (this.isEditing) {
      this.closeCellEdit();
    }
    this.isSelectingCells = true;
    
    this.selectionStartRow = row;
    this.selectionEndRow = row;
    this.selectionStartCol = 0;
    this.selectionEndCol = this.colCount - 1;

    const colLabel = this.getColLabel(0);
    this.activeCellKey = `${colLabel}${row}`;
    this.isTypingFormula = false;
    const cell = this.activeSheet?.data.cells[this.activeCellKey];
    this.editingValue = cell ? cell.value : '';
  }

  onRowHeaderMouseEnter(row: number) {
    if (!this.isSelectingCells) return;
    this.selectionEndRow = row;
    this.selectionEndCol = this.colCount - 1;
  }

  onColHeaderMouseDown(event: MouseEvent, colIdx: number) {
    if (event.button !== 0) return;
    if (this.isEditing) {
      this.closeCellEdit();
    }
    this.isSelectingCells = true;

    this.selectionStartRow = 1;
    this.selectionEndRow = this.rowCount;
    this.selectionStartCol = colIdx;
    this.selectionEndCol = colIdx;

    const colLabel = this.getColLabel(colIdx);
    this.activeCellKey = `${colLabel}1`;
    this.isTypingFormula = false;
    const cell = this.activeSheet?.data.cells[this.activeCellKey];
    this.editingValue = cell ? cell.value : '';
  }

  onColHeaderMouseEnter(colIdx: number) {
    if (!this.isSelectingCells) return;
    this.selectionEndCol = colIdx;
    this.selectionEndRow = this.rowCount;
  }

  onFillHandleMouseDown(event: MouseEvent, row: number, colIndex: number) {
    event.stopPropagation();
    event.preventDefault();
    this.isDraggingFill = true;
    this.dragStartRow = row;
    this.dragStartCol = colIndex;
    this.dragStartValue = this.getCellValue(row, colIndex);
    this.dragCurrentRow = row;
    this.dragCurrentCol = colIndex;
  }

  onCellMouseEnter(row: number, colIndex: number) {
    if (this.isDraggingFill) {
      this.dragCurrentRow = row;
      this.dragCurrentCol = colIndex;
    } else if (this.isSelectingCells) {
      this.selectionEndRow = row;
      this.selectionEndCol = colIndex;
    }
  }

  isCellInDragRange(row: number, colIndex: number): boolean {
    if (!this.isDraggingFill) return false;

    const startRow = this.dragStartRow;
    const endRow = this.dragCurrentRow;
    const startCol = this.dragStartCol;
    const endCol = this.dragCurrentCol;

    const rowDiff = Math.abs(endRow - startRow);
    const colDiff = Math.abs(endCol - startCol);

    if (rowDiff >= colDiff) {
      // Vertical dragging
      const minRow = Math.min(startRow, endRow);
      const maxRow = Math.max(startRow, endRow);
      return colIndex === startCol && row >= minRow && row <= maxRow;
    } else {
      // Horizontal dragging
      const minCol = Math.min(startCol, endCol);
      const maxCol = Math.max(startCol, endCol);
      return row === startRow && colIndex >= minCol && colIndex <= maxCol;
    }
  }

  @HostListener('window:mousemove', ['$event'])
  onWindowMouseMove(event: MouseEvent) {
    if (this.isResizingCol) {
      const deltaX = event.clientX - this.resizeStartX;
      const newWidth = Math.max(40, this.resizeStartSize + deltaX);
      this.colWidths[this.resizingColIdx] = newWidth;
    } else if (this.isResizingRow) {
      const deltaY = event.clientY - this.resizeStartY;
      const newHeight = Math.max(18, this.resizeStartSize + deltaY);
      this.rowHeights[this.resizingRowIdx] = newHeight;
    }
  }

  @HostListener('window:mouseup', ['$event'])
  onWindowMouseUp(event: MouseEvent) {
    if (this.isSelectingCells) {
      this.isSelectingCells = false;
    }

    if (this.isResizingCol || this.isResizingRow) {
      this.isResizingCol = false;
      this.isResizingRow = false;
      this.triggerChange();
    }

    if (!this.isDraggingFill) return;
    this.isDraggingFill = false;

    if (!this.activeSheet) return;

    const cells = this.activeSheet.data.cells;
    const startRow = this.dragStartRow;
    const endRow = this.dragCurrentRow;
    const startCol = this.dragStartCol;
    const endCol = this.dragCurrentCol;
    const startValue = this.dragStartValue;

    const isNumeric = /^-?\d+(\.\d+)?$/.test(startValue.trim());

    const rowDiff = Math.abs(endRow - startRow);
    const colDiff = Math.abs(endCol - startCol);

    if (rowDiff >= colDiff) {
      // Vertical dragging
      const minRow = Math.min(startRow, endRow);
      const maxRow = Math.max(startRow, endRow);
      const colLabel = this.getColLabel(startCol);

      for (let r = minRow; r <= maxRow; r++) {
        if (r === startRow) continue;
        const key = `${colLabel}${r}`;
        let newValue = startValue;
        if (isNumeric) {
          const startNum = parseFloat(startValue);
          const step = r - startRow;
          newValue = (startNum + step).toString();
        }
        if (!cells[key]) {
          cells[key] = { value: newValue };
        } else {
          cells[key].value = newValue;
        }
      }
    } else {
      // Horizontal dragging
      const minCol = Math.min(startCol, endCol);
      const maxCol = Math.max(startCol, endCol);

      for (let c = minCol; c <= maxCol; c++) {
        if (c === startCol) continue;
        const key = `${this.getColLabel(c)}${startRow}`;
        let newValue = startValue;
        if (isNumeric) {
          const startNum = parseFloat(startValue);
          const step = c - startCol;
          newValue = (startNum + step).toString();
        }
        if (!cells[key]) {
          cells[key] = { value: newValue };
        } else {
          cells[key].value = newValue;
        }
      }
    }

    this.dragStartRow = -1;
    this.dragStartCol = -1;
    this.dragCurrentRow = -1;
    this.dragCurrentCol = -1;

    this.triggerChange();
  }

  // Display value evaluation
  getCellValue(row: number, colIndex: number): string {
    const colLabel = this.getColLabel(colIndex);
    const key = `${colLabel}${row}`;
    const cell = this.activeSheet?.data.cells[key];
    if (!cell) return '';

    const val = cell.value;
    // Basic formula evaluation if it starts with '='
    if (val.startsWith('=')) {
      try {
        return this.evaluateFormula(val.substring(1));
      } catch (e) {
        return '#ERROR!';
      }
    }
    return val;
  }

  // Evaluates simple formulas like =SUM(A1:A3) or basic math operations
  private evaluateFormula(formula: string): string {
    const cleanFormula = formula.toUpperCase().trim();
    
    // SUM: e.g. SUM(A1:A5)
    if (cleanFormula.startsWith('SUM(') && cleanFormula.endsWith(')')) {
      const range = cleanFormula.substring(4, cleanFormula.length - 1);
      const cells = this.getCellsFromRange(range);
      let sum = 0;
      for (const cellKey of cells) {
        const val = parseFloat(this.activeSheet?.data.cells[cellKey]?.value || '0');
        if (!isNaN(val)) sum += val;
      }
      return sum.toString();
    }
    
    // AVERAGE: e.g. AVERAGE(B1:B10)
    if (cleanFormula.startsWith('AVERAGE(') && cleanFormula.endsWith(')')) {
      const range = cleanFormula.substring(8, cleanFormula.length - 1);
      const cells = this.getCellsFromRange(range);
      let sum = 0;
      let count = 0;
      for (const cellKey of cells) {
        const val = parseFloat(this.activeSheet?.data.cells[cellKey]?.value || '');
        if (!isNaN(val)) {
          sum += val;
          count++;
        }
      }
      return count > 0 ? (sum / count).toFixed(2).replace(/\.00$/, '') : '0';
    }

    // Basic expression evaluation (like =A1+B2 or =5*10)
    // Replace cell references with their real float values
    let evalExpr = cleanFormula;
    const cellRefRegex = /[A-Z]+\d+/g;
    let match;
    while ((match = cellRefRegex.exec(cleanFormula)) !== null) {
      const cellKey = match[0];
      const cellVal = parseFloat(this.activeSheet?.data.cells[cellKey]?.value || '0');
      // Replace only instances that match the word boundaries
      evalExpr = evalExpr.replace(new RegExp('\\b' + cellKey + '\\b', 'g'), isNaN(cellVal) ? '0' : cellVal.toString());
    }

    // Safety check: only allow mathematical characters in eval
    if (/^[0-9.+\-*/() ]+$/.test(evalExpr)) {
      // Use standard Function eval securely for basic math (no arbitrary code execution as checked by regex)
      const result = new Function(`return (${evalExpr})`)();
      return typeof result === 'number' ? result.toString() : '';
    }

    return '#VALUE!';
  }

  // Get array of cell coordinates from a range string like A1:B3
  private getCellsFromRange(range: string): string[] {
    const parts = range.split(':');
    if (parts.length !== 2) return [range];

    const start = parts[0];
    const end = parts[1];

    const startMatch = start.match(/^([A-Z]+)(\d+)$/);
    const endMatch = end.match(/^([A-Z]+)(\d+)$/);
    if (!startMatch || !endMatch) return [];

    const startCol = this.getColIndexFromLabel(startMatch[1]);
    const startRow = parseInt(startMatch[2], 10);
    const endCol = this.getColIndexFromLabel(endMatch[1]);
    const endRow = parseInt(endMatch[2], 10);

    const cells: string[] = [];
    const minCol = Math.min(startCol, endCol);
    const maxCol = Math.max(startCol, endCol);
    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);

    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        cells.push(`${this.getColLabel(c)}${r}`);
      }
    }
    return cells;
  }

  isCellSelected(row: number, colIndex: number): boolean {
    if (this.selectionStartRow === -1 || this.selectionStartCol === -1) {
      const match = this.activeCellKey.match(/^([A-Z]+)(\d+)$/);
      if (!match) return false;
      const activeRow = parseInt(match[2], 10);
      const activeCol = this.getColIndexFromLabel(match[1]);
      return row === activeRow && colIndex === activeCol;
    }

    const minRow = Math.min(this.selectionStartRow, this.selectionEndRow);
    const maxRow = Math.max(this.selectionStartRow, this.selectionEndRow);
    const minCol = Math.min(this.selectionStartCol, this.selectionEndCol);
    const maxCol = Math.max(this.selectionStartCol, this.selectionEndCol);

    return row >= minRow && row <= maxRow && colIndex >= minCol && colIndex <= maxCol;
  }

  @HostListener('window:copy', ['$event'])
  handleCopy(event: ClipboardEvent) {
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
      return;
    }

    if (!this.activeSheet) return;

    let minRow = this.selectionStartRow;
    let maxRow = this.selectionEndRow;
    let minCol = this.selectionStartCol;
    let maxCol = this.selectionEndCol;

    if (minRow === -1 || minCol === -1) {
      const match = this.activeCellKey.match(/^([A-Z]+)(\d+)$/);
      if (!match) return;
      minRow = maxRow = parseInt(match[2], 10);
      minCol = maxCol = this.getColIndexFromLabel(match[1]);
    }

    const startRow = Math.min(minRow, maxRow);
    const endRow = Math.max(minRow, maxRow);
    const startCol = Math.min(minCol, maxCol);
    const endCol = Math.max(minCol, maxCol);

    const rowsData: string[][] = [];
    for (let r = startRow; r <= endRow; r++) {
      const colData: string[] = [];
      for (let c = startCol; c <= endCol; c++) {
        colData.push(this.getCellValue(r, c));
      }
      rowsData.push(colData);
    }

    const tsv = rowsData.map(row => row.join('\t')).join('\n');
    event.clipboardData?.setData('text/plain', tsv);
    event.preventDefault();
  }

  @HostListener('window:paste', ['$event'])
  handlePaste(event: ClipboardEvent) {
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
      return;
    }

    if (!this.activeSheet) return;

    const tsv = event.clipboardData?.getData('text/plain');
    if (!tsv) return;

    this.pushHistory();

    const rows = tsv.split(/\r?\n/).map(row => row.split('\t'));
    
    let startRow = this.selectionStartRow;
    let startCol = this.selectionStartCol;

    if (startRow === -1 || startCol === -1) {
      const match = this.activeCellKey.match(/^([A-Z]+)(\d+)$/);
      if (!match) return;
      startRow = parseInt(match[2], 10);
      startCol = this.getColIndexFromLabel(match[1]);
    } else {
      startRow = Math.min(this.selectionStartRow, this.selectionEndRow);
      startCol = Math.min(this.selectionStartCol, this.selectionEndCol);
    }

    const cells = this.activeSheet.data.cells;
    let cellsChanged = false;

    for (let rIdx = 0; rIdx < rows.length; rIdx++) {
      const targetRow = startRow + rIdx;
      if (targetRow > this.rowCount) continue;

      const rowValues = rows[rIdx];
      if (rIdx === rows.length - 1 && rowValues.length === 1 && rowValues[0] === '') {
        continue;
      }

      for (let cIdx = 0; cIdx < rowValues.length; cIdx++) {
        const targetColIndex = startCol + cIdx;
        if (targetColIndex >= this.colCount) continue;

        const val = rowValues[cIdx];
        const colLabel = this.getColLabel(targetColIndex);
        const cellKey = `${colLabel}${targetRow}`;

        if (!cells[cellKey]) {
          cells[cellKey] = { value: val };
        } else {
          cells[cellKey].value = val;
        }

        this.handleAutoLookup(cellKey, val);
        cellsChanged = true;
      }
    }

    if (cellsChanged) {
      const currentCell = cells[this.activeCellKey];
      this.editingValue = currentCell ? currentCell.value : '';

      this.triggerChange();
      event.preventDefault();
    }
  }
}
