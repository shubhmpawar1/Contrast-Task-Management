import { Component, signal } from '@angular/core';
import { SpreadsheetComponent } from './components/spreadsheet/spreadsheet';

@Component({
  selector: 'app-root',
  imports: [SpreadsheetComponent],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly title = signal('frontend');
}
