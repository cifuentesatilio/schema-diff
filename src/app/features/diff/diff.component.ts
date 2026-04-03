import { Component, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SchemaParserService } from '../../core/services/schema-parser.service';
import { SchemaDiff, DiffItem } from '../../core/models/schema.models';

interface CategoryConfig {
  label: string;
  icon: string;
  color: string;
}

@Component({
  selector: 'app-diff',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './diff.component.html',
  styleUrl: './diff.component.scss',
})
export class DiffComponent {
  // ── Signals ───────────────────────────────────────────────────────────────

  fileA = signal<File | null>(null);
  fileB = signal<File | null>(null);
  labelA = signal('DEV');
  labelB = signal('QA');
  loading = signal(false);
  result = signal<SchemaDiff | null>(null);
  error = signal<string | null>(null);
  activeTab = signal<keyof SchemaDiff['diferencias']>('tablas');
  dragOver = signal<'A' | 'B' | null>(null);
  filterDb = signal('TODAS');
  filterLado = signal('TODOS');
  search = signal('');

  // ── Config ────────────────────────────────────────────────────────────────

  categories: Record<keyof SchemaDiff['diferencias'], CategoryConfig> = {
    tablas: { label: 'Tablas', icon: '⬛', color: '#3b82f6' },
    columnas: { label: 'Columnas', icon: '▦', color: '#8b5cf6' },
    indices: { label: 'Índices & Keys', icon: '⚡', color: '#f59e0b' },
    vistas: { label: 'Vistas', icon: '👁', color: '#06b6d4' },
    procedures: { label: 'Stored Procedures', icon: '⚙', color: '#10b981' },
    functions: { label: 'Functions', icon: 'ƒ', color: '#ec4899' },
    triggers: { label: 'Triggers', icon: '⚑', color: '#f97316' },
  };

  categoryKeys = Object.keys(this.categories) as (keyof SchemaDiff['diferencias'])[];

  tipoBadge: Record<string, { bg: string; color: string; label: string }> = {
    nueva: { bg: '#064e3b', color: '#6ee7b7', label: 'NUEVA' },
    nuevo: { bg: '#064e3b', color: '#6ee7b7', label: 'NUEVO' },
    eliminada: { bg: '#4c0519', color: '#fda4af', label: 'ELIMINADA' },
    eliminado: { bg: '#4c0519', color: '#fda4af', label: 'ELIMINADO' },
    modificada: { bg: '#1e3a5f', color: '#93c5fd', label: 'MODIFICADA' },
    modificado: { bg: '#1e3a5f', color: '#93c5fd', label: 'MODIFICADO' },
    agregada: { bg: '#064e3b', color: '#6ee7b7', label: 'AGREGADA' },
    agregado: { bg: '#064e3b', color: '#6ee7b7', label: 'AGREGADO' },
    renombrado: { bg: '#2d1b69', color: '#c4b5fd', label: 'RENOMBRADO' },
    renombrada: { bg: '#2d1b69', color: '#c4b5fd', label: 'RENOMBRADA' },
  };

  // ── Computed ──────────────────────────────────────────────────────────────

  allDbs = computed(() => {
    const r = this.result();
    if (!r) return [];
    const dbs = new Set<string>();
    Object.values(r.diferencias)
      .flat()
      .forEach((i: DiffItem) => {
        if (i.base_datos) dbs.add(i.base_datos);
      });
    return [...dbs].sort();
  });

  filteredItems = computed(() => {
    const r = this.result();
    if (!r) return [];
    return r.diferencias[this.activeTab()].filter((item: DiffItem) => {
      const db = item.base_datos || '';
      const nombre = item.nombre || item.columna || item.tabla || '';
      if (this.filterDb() !== 'TODAS' && db !== this.filterDb()) return false;
      if (this.filterLado() !== 'TODOS' && item.lado !== this.filterLado()) return false;
      if (this.search()) {
        const q = this.search().toLowerCase();
        return (
          nombre.toLowerCase().includes(q) ||
          (item.tabla || '').toLowerCase().includes(q) ||
          (item.detalle || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  });

  totalDiff = computed(() => this.result()?.resumen.total_diferencias ?? 0);

  constructor(private parser: SchemaParserService) {}

  // ── Methods ───────────────────────────────────────────────────────────────

  onDrop(event: DragEvent, side: 'A' | 'B'): void {
    event.preventDefault();
    this.dragOver.set(null);
    const file = event.dataTransfer?.files[0];
    if (file && this.isValidFile(file)) {
      side === 'A' ? this.fileA.set(file) : this.fileB.set(file);
    } else if (file) {
      this.error.set('Solo se aceptan archivos .sql');
    }
  }

  onFileChange(event: Event, side: 'A' | 'B'): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file && this.isValidFile(file)) {
      side === 'A' ? this.fileA.set(file) : this.fileB.set(file);
    } else if (file) {
      this.error.set('Solo se aceptan archivos .sql');
    }
  }

  private isValidFile(file: File): boolean {
    const validTypes = ['application/sql', 'text/plain', 'text/x-sql', 'application/x-sql', ''];
    const validExt = file.name.toLowerCase().endsWith('.sql');
    const validSize = file.size <= 50 * 1024 * 1024; // 50MB
    return validExt && validSize;
  }

  async analyze(): Promise<void> {
    if (!this.fileA() || !this.fileB()) return;
    this.loading.set(true);
    this.error.set(null);
    this.result.set(null);

    try {
      const [textA, textB] = await Promise.all([
        this.readFile(this.fileA()!),
        this.readFile(this.fileB()!),
      ]);

      const devParsed = this.parser.parse(textA);
      const qaParsed = this.parser.parse(textB);
      const res = this.parser.compare(devParsed, qaParsed, this.labelA(), this.labelB());

      this.result.set(res);
      this.filterDb.set('TODAS');
      this.filterLado.set('TODOS');
      this.search.set('');

      const firstWithDiff = this.categoryKeys.find((k) => res.resumen[k] > 0);
      this.activeTab.set(firstWithDiff || 'tablas');
    } catch (err: any) {
      this.error.set(`Error: ${err.message}`);
    } finally {
      this.loading.set(false);
    }
  }

  setTab(tab: keyof SchemaDiff['diferencias']): void {
    this.activeTab.set(tab);
  }

  getCount(key: keyof SchemaDiff['diferencias']): number {
    return this.result()?.resumen[key] ?? 0;
  }

  getBadge(tipo: string) {
    return this.tipoBadge[tipo] ?? { bg: '#1e293b', color: '#94a3b8', label: tipo.toUpperCase() };
  }

  getLadoColor(lado: string): string {
    if (lado === this.labelA()) return '#3b82f6';
    if (lado === this.labelB()) return '#8b5cf6';
    return '#64748b';
  }

  getFileSize(file: File | null): string {
    if (!file) return '';
    return (file.size / 1024).toFixed(1) + ' KB';
  }

  private readFile(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.onerror = () => reject(new Error('Error leyendo archivo'));
      reader.readAsText(file);
    });
  }
}
