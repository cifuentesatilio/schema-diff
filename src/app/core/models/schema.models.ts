export interface ColumnDef {
  name: string;
  definition: string;
}

export interface TableDef {
  db: string;
  name: string;
  columns: Record<string, string>;
  keys: Record<string, string>;
  constraints: Record<string, string>;
}

export interface TriggerDef {
  db: string;
  name: string;
  timing: string;
  event: string;
  table: string;
}

export interface RoutineDef {
  db: string;
  name: string;
  body: string;
}

export interface ViewDef {
  db: string;
  name: string;
  body: string;
}

export interface ParsedSchema {
  tables: Record<string, TableDef>;
  triggers: Record<string, TriggerDef>;
  procedures: Record<string, RoutineDef>;
  functions: Record<string, RoutineDef>;
  views: Record<string, ViewDef>;
}

export type DiffType =
  | 'nueva'
  | 'nuevo'
  | 'eliminada'
  | 'eliminado'
  | 'modificada'
  | 'modificado'
  | 'agregada'
  | 'agregado'
  | 'renombrado'
  | 'renombrada';

export interface DiffItem {
  nombre?: string;
  tabla?: string;
  columna?: string;
  base_datos: string;
  tipo: DiffType;
  lado: string;
  detalle: string;
}

export interface SchemaDiff {
  resumen: {
    total_diferencias: number;
    tablas: number;
    columnas: number;
    indices: number;
    vistas: number;
    procedures: number;
    functions: number;
    triggers: number;
  };
  diferencias: {
    tablas: DiffItem[];
    columnas: DiffItem[];
    indices: DiffItem[];
    vistas: DiffItem[];
    procedures: DiffItem[];
    functions: DiffItem[];
    triggers: DiffItem[];
  };
}
