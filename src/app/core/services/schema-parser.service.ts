import { Injectable } from '@angular/core';
import {
  ParsedSchema,
  TableDef,
  TriggerDef,
  RoutineDef,
  ViewDef,
  SchemaDiff,
  DiffItem,
} from '../models/schema.models';

@Injectable({ providedIn: 'root' })
export class SchemaParserService {
  // ── Parser ────────────────────────────────────────────────────────────────

  parse(sql: string): ParsedSchema {
    this.validateInput(sql);

    const result: ParsedSchema = {
      tables: {},
      triggers: {},
      procedures: {},
      functions: {},
      views: {},
    };

    const lines = sql
      .split('\n')
      .map((l) => l.replace(/ COMMENT '[^']*'/g, '').replace(/AUTO_INCREMENT=\d+/g, ''));

    const fullText = lines.join('\n');

    // Track USE statements by character position
    const useStmts: { pos: number; db: string }[] = [];
    for (const m of fullText.matchAll(/^USE `([^`]+)`/gim)) {
      useStmts.push({ pos: m.index!, db: m[1] });
    }

    const getDb = (pos: number): string => {
      let db = '';
      for (const u of useStmts) {
        if (u.pos <= pos) db = u.db;
        else break;
      }
      return db;
    };

    // ── Tables ──
    const tableRe = /CREATE TABLE `([^`]+)`\s*\(([\s\S]*?)\)\s*ENGINE/gi;
    for (const m of fullText.matchAll(tableRe)) {
      const db = getDb(m.index!);
      const key = `${db}.${m[1]}`;
      const body = m[2];

      const columns: Record<string, string> = {};
      const keys: Record<string, string> = {};
      const constraints: Record<string, string> = {};

      for (const line of body.split('\n')) {
        const l = line.trim().replace(/,$/, '');
        if (!l) continue;

        const colM = l.match(/^`([^`]+)`\s+(.+)/);
        if (colM) {
          columns[colM[1]] = colM[2];
          continue;
        }

        const conM = l.match(/^CONSTRAINT `([^`]+)`\s+(.+)/);
        if (conM) {
          constraints[conM[1]] = conM[2];
          continue;
        }

        if (/^PRIMARY KEY/i.test(l)) {
          keys['__PRIMARY__'] = l;
          continue;
        }

        const keyM = l.match(/^(UNIQUE KEY|KEY)\s+`([^`]+)`\s*(.+)/i);
        if (keyM) {
          keys[keyM[2]] = l;
          continue;
        }
      }

      result.tables[key] = { db, name: m[1], columns, keys, constraints };
    }

    // ── Triggers ──
    const trigRe =
      /TRIGGER\s+`([^`]+)`\s+(BEFORE|AFTER)\s+(INSERT|UPDATE|DELETE)\s+ON\s+`([^`]+)`/gi;
    for (const m of fullText.matchAll(trigRe)) {
      const db = getDb(m.index!);
      const key = `${db}.${m[1]}`;
      result.triggers[key] = { db, name: m[1], timing: m[2], event: m[3], table: m[4] };
    }

    // ── Views ──
    const viewRe = /CREATE.*?VIEW\s+`([^`]+)`\s+AS\s+([\s\S]*?);/gi;
    for (const m of fullText.matchAll(viewRe)) {
      const db = getDb(m.index!);
      const key = `${db}.${m[1]}`;
      result.views[key] = { db, name: m[1], body: m[2].trim() };
    }

    // ── Procedures ──
    const procRe = /CREATE\s+DEFINER[\s\S]*?PROCEDURE\s+`([^`]+)`([\s\S]*?)(?=DELIMITER\s*;)/gi;
    for (const m of fullText.matchAll(procRe)) {
      const db = getDb(m.index!);
      const key = `${db}.${m[1]}`;
      const normalized = m[0]
        .replace(/DEFINER=`[^`]+`@`[^`]+`/gi, 'DEFINER=x@x')
        .replace(/\s+/g, ' ')
        .trim();
      result.procedures[key] = { db, name: m[1], body: normalized };
    }

    // ── Functions ──
    const funcRe = /CREATE\s+DEFINER[\s\S]*?FUNCTION\s+`([^`]+)`([\s\S]*?)(?=DELIMITER\s*;)/gi;
    for (const m of fullText.matchAll(funcRe)) {
      const db = getDb(m.index!);
      const key = `${db}.${m[1]}`;
      const normalized = m[0]
        .replace(/DEFINER=`[^`]+`@`[^`]+`/gi, 'DEFINER=x@x')
        .replace(/\s+/g, ' ')
        .trim();
      result.functions[key] = { db, name: m[1], body: normalized };
    }

    return result;
  }

  // ── Compare ───────────────────────────────────────────────────────────────

  compare(
    devParsed: ParsedSchema,
    qaParsed: ParsedSchema,
    labelA: string,
    labelB: string,
  ): SchemaDiff {
    const diff: SchemaDiff['diferencias'] = {
      tablas: [],
      columnas: [],
      indices: [],
      vistas: [],
      procedures: [],
      functions: [],
      triggers: [],
    };

    // ── Tables ──
    const allTables = new Set([...Object.keys(devParsed.tables), ...Object.keys(qaParsed.tables)]);
    for (const key of allTables) {
      const inDev = key in devParsed.tables;
      const inQa = key in qaParsed.tables;
      const [db, name] = key.split('.');

      if (inDev && !inQa) {
        diff.tablas.push({
          nombre: name,
          base_datos: db,
          tipo: 'nueva',
          lado: labelA,
          detalle: `Solo en ${labelA}`,
        });
      } else if (!inDev && inQa) {
        diff.tablas.push({
          nombre: name,
          base_datos: db,
          tipo: 'nueva',
          lado: labelB,
          detalle: `Solo en ${labelB}`,
        });
      } else {
        this.diffColumns(
          devParsed.tables[key],
          qaParsed.tables[key],
          db,
          name,
          labelA,
          labelB,
          diff,
        );
        this.diffKeys(devParsed.tables[key], qaParsed.tables[key], db, name, labelA, labelB, diff);
        this.diffConstraints(
          devParsed.tables[key],
          qaParsed.tables[key],
          db,
          name,
          labelA,
          labelB,
          diff,
        );
      }
    }

    // ── Triggers ──
    const allTrigs = new Set([
      ...Object.keys(devParsed.triggers),
      ...Object.keys(qaParsed.triggers),
    ]);
    for (const key of allTrigs) {
      const inDev = key in devParsed.triggers;
      const inQa = key in qaParsed.triggers;
      const obj = devParsed.triggers[key] ?? qaParsed.triggers[key];
      if (inDev && !inQa) {
        diff.triggers.push({
          nombre: obj.name,
          base_datos: obj.db,
          tipo: 'nuevo',
          lado: labelA,
          detalle: `${obj.timing} ${obj.event} ON ${obj.table} — solo en ${labelA}`,
        });
      } else if (!inDev && inQa) {
        diff.triggers.push({
          nombre: obj.name,
          base_datos: obj.db,
          tipo: 'nuevo',
          lado: labelB,
          detalle: `${obj.timing} ${obj.event} ON ${obj.table} — solo en ${labelB}`,
        });
      }
    }

    // ── Views ──
    const allViews = new Set([...Object.keys(devParsed.views), ...Object.keys(qaParsed.views)]);
    for (const key of allViews) {
      const inDev = key in devParsed.views;
      const inQa = key in qaParsed.views;
      const [db, name] = key.split('.');
      if (inDev && !inQa) {
        diff.vistas.push({
          nombre: name,
          base_datos: db,
          tipo: 'nueva',
          lado: labelA,
          detalle: `Solo en ${labelA}`,
        });
      } else if (!inDev && inQa) {
        diff.vistas.push({
          nombre: name,
          base_datos: db,
          tipo: 'nueva',
          lado: labelB,
          detalle: `Solo en ${labelB}`,
        });
      } else if (devParsed.views[key].body !== qaParsed.views[key].body) {
        diff.vistas.push({
          nombre: name,
          base_datos: db,
          tipo: 'modificada',
          lado: 'AMBOS',
          detalle: 'Definición de vista diferente',
        });
      }
    }

    // ── Procedures ──
    this.diffRoutines(devParsed.procedures, qaParsed.procedures, labelA, labelB, diff.procedures);

    // ── Functions ──
    this.diffRoutines(
      devParsed.functions,
      qaParsed.functions,
      labelA,
      labelB,
      diff.functions,
      true,
    );

    const resumen = {
      tablas: diff.tablas.length,
      columnas: diff.columnas.length,
      indices: diff.indices.length,
      vistas: diff.vistas.length,
      procedures: diff.procedures.length,
      functions: diff.functions.length,
      triggers: diff.triggers.length,
      total_diferencias: 0,
    };
    resumen.total_diferencias = Object.values(resumen).reduce((a, b) => a + b, 0);

    return { resumen, diferencias: diff };
  }

  private validateInput(sql: string): void {
    if (!sql || typeof sql !== 'string') {
      throw new Error('Archivo inválido');
    }
    if (sql.length > 50 * 1024 * 1024) {
      // 50MB máximo
      throw new Error('Archivo demasiado grande (máximo 50MB)');
    }
    if (
      !sql.includes('CREATE TABLE') &&
      !sql.includes('CREATE PROCEDURE') &&
      !sql.includes('CREATE FUNCTION') &&
      !sql.includes('CREATE TRIGGER')
    ) {
      throw new Error('El archivo no parece ser un dump de MySQL válido');
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private diffColumns(
    devT: TableDef,
    qaT: TableDef,
    db: string,
    name: string,
    labelA: string,
    labelB: string,
    diff: SchemaDiff['diferencias'],
  ): void {
    const all = new Set([...Object.keys(devT.columns), ...Object.keys(qaT.columns)]);
    for (const col of all) {
      if (!(col in qaT.columns)) {
        diff.columnas.push({
          tabla: name,
          base_datos: db,
          columna: col,
          tipo: 'agregada',
          lado: labelA,
          detalle: devT.columns[col],
        });
      } else if (!(col in devT.columns)) {
        diff.columnas.push({
          tabla: name,
          base_datos: db,
          columna: col,
          tipo: 'agregada',
          lado: labelB,
          detalle: qaT.columns[col],
        });
      } else if (devT.columns[col] !== qaT.columns[col]) {
        diff.columnas.push({
          tabla: name,
          base_datos: db,
          columna: col,
          tipo: 'modificada',
          lado: 'AMBOS',
          detalle: `${labelA}: ${devT.columns[col]} → ${labelB}: ${qaT.columns[col]}`,
        });
      }
    }
  }

  private diffKeys(
    devT: TableDef,
    qaT: TableDef,
    db: string,
    name: string,
    labelA: string,
    labelB: string,
    diff: SchemaDiff['diferencias'],
  ): void {
    const keySignature = (k: string) => {
      const m = k.match(/\(([^)]+)\)\s*$/);
      return m ? m[1].replace(/`/g, '').replace(/\s+/g, '').toLowerCase() : k;
    };
    const isUnique = (k: string) => /^UNIQUE/i.test(k.trim());

    const devOnly = Object.keys(devT.keys).filter((k) => !(k in qaT.keys));
    const qaOnly = Object.keys(qaT.keys).filter((k) => !(k in devT.keys));

    // Same name both sides
    for (const k of Object.keys(devT.keys).filter((k) => k in qaT.keys)) {
      const kName = k === '__PRIMARY__' ? 'PRIMARY KEY' : k;
      if (keySignature(devT.keys[k]) !== keySignature(qaT.keys[k])) {
        diff.indices.push({
          tabla: name,
          base_datos: db,
          nombre: kName,
          tipo: 'modificado',
          lado: 'AMBOS',
          detalle: `Columnas cambiaron · ${labelA}: ${devT.keys[k]} → ${labelB}: ${qaT.keys[k]}`,
        });
      } else if (isUnique(devT.keys[k]) !== isUnique(qaT.keys[k])) {
        diff.indices.push({
          tabla: name,
          base_datos: db,
          nombre: kName,
          tipo: 'modificado',
          lado: 'AMBOS',
          detalle: `Uniqueness cambió · ${labelA}: ${devT.keys[k]} → ${labelB}: ${qaT.keys[k]}`,
        });
      }
    }

    // Match by signature
    const devSigs: Record<string, string> = {};
    devOnly.forEach((k) => {
      devSigs[keySignature(devT.keys[k])] = k;
    });
    const qaSigs: Record<string, string> = {};
    qaOnly.forEach((k) => {
      qaSigs[keySignature(qaT.keys[k])] = k;
    });

    const matchedDev = new Set<string>();
    const matchedQa = new Set<string>();

    for (const devName of devOnly) {
      const sig = keySignature(devT.keys[devName]);
      if (sig in qaSigs) {
        const qaName = qaSigs[sig];
        diff.indices.push({
          tabla: name,
          base_datos: db,
          nombre: devName,
          tipo: 'renombrado',
          lado: 'AMBOS',
          detalle: `${labelA}: "${devName}" → ${labelB}: "${qaName}" · columnas: (${sig})`,
        });
        matchedDev.add(devName);
        matchedQa.add(qaName);
      }
    }

    for (const k of devOnly.filter((k) => !matchedDev.has(k))) {
      diff.indices.push({
        tabla: name,
        base_datos: db,
        nombre: k,
        tipo: 'nuevo',
        lado: labelA,
        detalle: devT.keys[k],
      });
    }
    for (const k of qaOnly.filter((k) => !matchedQa.has(k))) {
      diff.indices.push({
        tabla: name,
        base_datos: db,
        nombre: k,
        tipo: 'nuevo',
        lado: labelB,
        detalle: qaT.keys[k],
      });
    }
  }

  private diffConstraints(
    devT: TableDef,
    qaT: TableDef,
    db: string,
    name: string,
    labelA: string,
    labelB: string,
    diff: SchemaDiff['diferencias'],
  ): void {
    const conSig = (body: string) => body.replace(/\s+/g, ' ').trim().toLowerCase();

    const devOnly = Object.keys(devT.constraints).filter((c) => !(c in qaT.constraints));
    const qaOnly = Object.keys(qaT.constraints).filter((c) => !(c in devT.constraints));

    for (const c of Object.keys(devT.constraints).filter((c) => c in qaT.constraints)) {
      if (devT.constraints[c] !== qaT.constraints[c]) {
        diff.indices.push({
          tabla: name,
          base_datos: db,
          nombre: c,
          tipo: 'modificado',
          lado: 'AMBOS',
          detalle: `CONSTRAINT cambió · ${labelA}: ${devT.constraints[c]} → ${labelB}: ${qaT.constraints[c]}`,
        });
      }
    }

    const devSigs: Record<string, string> = {};
    devOnly.forEach((c) => {
      devSigs[conSig(devT.constraints[c])] = c;
    });
    const qaSigs: Record<string, string> = {};
    qaOnly.forEach((c) => {
      qaSigs[conSig(qaT.constraints[c])] = c;
    });

    const matchedDev = new Set<string>();
    const matchedQa = new Set<string>();

    for (const devName of devOnly) {
      const sig = conSig(devT.constraints[devName]);
      if (sig in qaSigs) {
        const qaName = qaSigs[sig];
        diff.indices.push({
          tabla: name,
          base_datos: db,
          nombre: devName,
          tipo: 'renombrado',
          lado: 'AMBOS',
          detalle: `CONSTRAINT renombrado · ${labelA}: "${devName}" → ${labelB}: "${qaName}"`,
        });
        matchedDev.add(devName);
        matchedQa.add(qaName);
      }
    }

    for (const c of devOnly.filter((c) => !matchedDev.has(c))) {
      diff.indices.push({
        tabla: name,
        base_datos: db,
        nombre: c,
        tipo: 'nuevo',
        lado: labelA,
        detalle: `CONSTRAINT: ${devT.constraints[c]}`,
      });
    }
    for (const c of qaOnly.filter((c) => !matchedQa.has(c))) {
      diff.indices.push({
        tabla: name,
        base_datos: db,
        nombre: c,
        tipo: 'nuevo',
        lado: labelB,
        detalle: `CONSTRAINT: ${qaT.constraints[c]}`,
      });
    }
  }

  private diffRoutines(
    devRoutines: Record<string, RoutineDef>,
    qaRoutines: Record<string, RoutineDef>,
    labelA: string,
    labelB: string,
    target: DiffItem[],
    isFunction = false,
  ): void {
    const tipoNuevo = isFunction ? 'nueva' : 'nuevo';
    const all = new Set([...Object.keys(devRoutines), ...Object.keys(qaRoutines)]);
    for (const key of all) {
      const [db, name] = key.split('.');
      const inDev = key in devRoutines;
      const inQa = key in qaRoutines;
      if (inDev && !inQa) {
        target.push({
          nombre: name,
          base_datos: db,
          tipo: tipoNuevo,
          lado: labelA,
          detalle: `Solo en ${labelA}`,
        });
      } else if (!inDev && inQa) {
        target.push({
          nombre: name,
          base_datos: db,
          tipo: tipoNuevo,
          lado: labelB,
          detalle: `Solo en ${labelB}`,
        });
      } else if (devRoutines[key].body !== qaRoutines[key].body) {
        const devStmts = devRoutines[key].body.split(';').length;
        const qaStmts = qaRoutines[key].body.split(';').length;
        target.push({
          nombre: name,
          base_datos: db,
          tipo: 'modificado',
          lado: 'AMBOS',
          detalle: `Cuerpo modificado · ${labelA}: ~${devStmts} sentencias · ${labelB}: ~${qaStmts} sentencias`,
        });
      }
    }
  }
}
