import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface SheetListItem {
  id: number;
  name: string;
  table_name: string;
  updated_at: string;
}

export interface SheetCell {
  value: string;
  bold?: boolean;
  italic?: boolean;
  color?: string; // Hex color or Tailwind color class
  bg?: string;    // Hex color or Tailwind color class
}

export interface SheetData {
  rows: number;
  cols: number;
  headers?: string[];       // column header labels e.g. ['Sr No', 'Module', 'UI Status']
  statusCols?: number[];    // 0-based col indices that render as status dropdowns
  readonlyCols?: number[];  // 0-based col indices that are read-only (e.g. Sr No)
  cells: { [key: string]: SheetCell };
}

export interface Sheet {
  id: number;
  name: string;
  table_name: string;
  data: SheetData;
  updated_at: string;
}

@Injectable({
  providedIn: 'root',
})
export class SpreadsheetService {
  private http = inject(HttpClient);
  private apiUrl = 'https://contrast-task-management-1.onrender.com/api/sheets';
  private tablesUrl = 'https://contrast-task-management-1.onrender.com/api/tables';

  getSheets(): Observable<SheetListItem[]> {
    return this.http.get<SheetListItem[]>(this.apiUrl);
  }

  getSheet(id: number): Observable<Sheet> {
    return this.http.get<Sheet>(`${this.apiUrl}/${id}`);
  }

  createSheet(name?: string): Observable<Sheet> {
    return this.http.post<Sheet>(this.apiUrl, { name });
  }

  updateSheet(id: number, update: { name?: string; data?: SheetData }): Observable<Sheet> {
    return this.http.put<Sheet>(`${this.apiUrl}/${id}`, update);
  }

  deleteSheet(id: number): Observable<{ message: string; id: number }> {
    return this.http.delete<{ message: string; id: number }>(`${`${this.apiUrl}/${id}`}`);
  }

  /** Fetch all rows from a real table — used to populate cross-sheet dropdowns */
  getTableValues(tableName: string): Observable<{ columns: string[]; rows: Record<string, string>[] }> {
    return this.http.get<{ columns: string[]; rows: Record<string, string>[] }>(
      `${this.tablesUrl}/${tableName}/values`
    );
  }
}
