import { Component } from '@angular/core';
import { DiffComponent } from './features/diff/diff.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [DiffComponent],
  template: `<app-diff />`,
})
export class AppComponent {}
