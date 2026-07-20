import XLSX from 'xlsx-js-style';
import { Platform } from 'react-native';
import {
  writeAsStringAsync,
  documentDirectory,
  cacheDirectory,
  getInfoAsync,
  EncodingType,
} from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ByProductRow {
  id: number; date: string; shift: string; operator: string;
  materialType: string; stationName: string; category: string;
  name: string; weight: number;
}

export interface ByProductItem {
  id: number; name: string; category: string; weight: number;
  stationName: string; materialType: string; operator: string;
}
export interface ByProductShiftGroup { shiftName: string; shiftTotal: number; items: ByProductItem[]; }
export interface ByProductDayGroup   { date: string; dayTotal: number; shifts: ByProductShiftGroup[]; }

// ── Column definitions ────────────────────────────────────────────────────────

const COL_WIDTHS = [16, 14, 26, 16, 22, 22, 14]; // Date, Shift, Name, Category, Station, Operator, Weight

// ── Styles ────────────────────────────────────────────────────────────────────

const BORDER = {
  top:    { style: 'thin', color: { rgb: 'BDBDBD' } },
  bottom: { style: 'thin', color: { rgb: 'BDBDBD' } },
  left:   { style: 'thin', color: { rgb: 'BDBDBD' } },
  right:  { style: 'thin', color: { rgb: 'BDBDBD' } },
};

const HEADER_STYLE = {
  font:      { bold: true, color: { rgb: 'FFFFFF' }, sz: 11, name: 'Calibri' },
  fill:      { fgColor: { rgb: '1B5E20' }, patternType: 'solid' },
  alignment: { horizontal: 'center', vertical: 'center' },
  border: {
    top: { style: 'medium', color: { rgb: '000000' } },
    bottom: { style: 'medium', color: { rgb: '000000' } },
    left:   { style: 'thin',  color: { rgb: '000000' } },
    right:  { style: 'thin',  color: { rgb: '000000' } },
  },
};

const DAY_STYLE = {
  font:      { bold: true, sz: 11, name: 'Calibri', color: { rgb: '1A237E' } },
  fill:      { fgColor: { rgb: 'FFF9C4' }, patternType: 'solid' },
  alignment: { vertical: 'center' },
  border:    BORDER,
};

const DAY_TOTAL_STYLE = {
  ...DAY_STYLE,
  alignment: { horizontal: 'right', vertical: 'center' },
  font: { bold: true, sz: 11, name: 'Calibri', color: { rgb: '1A237E' } },
};

const SHIFT_STYLE = {
  font:      { bold: true, sz: 10, name: 'Calibri', color: { rgb: '1565C0' } },
  fill:      { fgColor: { rgb: 'E3F2FD' }, patternType: 'solid' },
  alignment: { vertical: 'center' },
  border:    BORDER,
};

const SHIFT_TOTAL_STYLE = {
  ...SHIFT_STYLE,
  alignment: { horizontal: 'right', vertical: 'center' },
};

const ROW_EVEN = {
  font:      { sz: 10, name: 'Calibri', color: { rgb: '212121' } },
  fill:      { fgColor: { rgb: 'F1F8E9' }, patternType: 'solid' },
  alignment: { vertical: 'center' },
  border:    BORDER,
};

const ROW_ODD = {
  font:      { sz: 10, name: 'Calibri', color: { rgb: '212121' } },
  fill:      { fgColor: { rgb: 'FFFFFF' }, patternType: 'solid' },
  alignment: { vertical: 'center' },
  border:    BORDER,
};

const NUM_STYLE_BASE = { alignment: { horizontal: 'right', vertical: 'center' }, border: BORDER };

// ── Helpers ───────────────────────────────────────────────────────────────────

function cell(ws: Record<string, unknown>, r: number, c: number, v: string | number, t: 's' | 'n', s: object) {
  ws[XLSX.utils.encode_cell({ r, c })] = { v, t, s };
}

function formatDateDMY(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${String(d.getUTCDate()).padStart(2,'0')}/${String(d.getUTCMonth()+1).padStart(2,'0')}/${d.getUTCFullYear()}`;
}

// ── Worksheet builder (grouped layout) ───────────────────────────────────────

function buildGroupedWorksheet(days: ByProductDayGroup[]) {
  const ws: Record<string, unknown> = {};
  const HEADERS = ['Date', 'Shift', 'By-Product Name', 'Category', 'Station', 'Operator', 'Weight (kg)'];
  let row = 0;

  // Header row
  HEADERS.forEach((h, c) => cell(ws, row, c, h, 's', HEADER_STYLE));
  row++;

  let itemRowCount = 0; // for alternating colours

  for (const day of days) {
    const dateStr = formatDateDMY(day.date);

    // Day header row
    HEADERS.forEach((_, c) => {
      if (c === 0) cell(ws, row, c, dateStr, 's', DAY_STYLE);
      else if (c === 5) cell(ws, row, c, 'Day Total', 's', DAY_STYLE);
      else if (c === 6) cell(ws, row, c, day.dayTotal, 'n', { ...DAY_TOTAL_STYLE, numFmt: '0.00' });
      else cell(ws, row, c, '', 's', DAY_STYLE);
    });
    row++;

    for (const shift of day.shifts) {
      // Shift sub-header row
      HEADERS.forEach((_, c) => {
        if (c === 1) cell(ws, row, c, shift.shiftName, 's', SHIFT_STYLE);
        else if (c === 5) cell(ws, row, c, 'Shift Total', 's', SHIFT_STYLE);
        else if (c === 6) cell(ws, row, c, shift.shiftTotal, 'n', { ...SHIFT_TOTAL_STYLE, numFmt: '0.00' });
        else cell(ws, row, c, '', 's', SHIFT_STYLE);
      });
      row++;

      // Item rows
      for (const item of shift.items) {
        const base = itemRowCount % 2 === 0 ? ROW_EVEN : ROW_ODD;
        cell(ws, row, 0, '',              's', base);
        cell(ws, row, 1, '',              's', base);
        cell(ws, row, 2, item.name || '', 's', base);
        cell(ws, row, 3, item.category || '', 's', base);
        cell(ws, row, 4, item.stationName || '', 's', base);
        cell(ws, row, 5, item.operator || '', 's', base);
        cell(ws, row, 6, Number(item.weight) || 0, 'n', { ...base, ...NUM_STYLE_BASE, numFmt: '0.00' });
        row++;
        itemRowCount++;
      }
    }
  }

  ws['!ref']    = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: row - 1, c: 6 } });
  ws['!cols']   = COL_WIDTHS.map((w) => ({ wch: w }));
  ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft' };
  return ws;
}

// ── CSV (flat, readable) ──────────────────────────────────────────────────────

function groupedToCsv(days: ByProductDayGroup[]): string {
  const headers = ['Date', 'Shift', 'By-Product Name', 'Category', 'Station', 'Operator', 'Weight (kg)'];
  const esc = (v: string | number) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [headers.join(',')];
  for (const day of days) {
    for (const shift of day.shifts) {
      for (const item of shift.items) {
        lines.push([
          formatDateDMY(day.date),
          shift.shiftName,
          item.name || '',
          item.category || '',
          item.stationName || '',
          item.operator || '',
          Number(item.weight) || 0,
        ].map(esc).join(','));
      }
    }
  }
  return lines.join('\n');
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function resolveWritableDir(): string {
  const raw = documentDirectory || cacheDirectory;
  if (!raw) throw new Error('No writable app directory');
  return raw.endsWith('/') ? raw : `${raw}/`;
}

function downloadBlobInBrowser(data: BlobPart, fileName: string, mime: string): void {
  const blob = new Blob([data], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = fileName;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function shareByProductsAsXlsx(
  data: ByProductDayGroup[],
  filenameBase: string,
): Promise<{ rowCount: number; format: 'xlsx' | 'csv' }> {
  const base      = filenameBase.replace(/[^a-zA-Z0-9._-]+/g, '_');
  const totalItems = data.reduce((s, d) => s + d.shifts.reduce((ss, sh) => ss + sh.items.length, 0), 0);

  if (Platform.OS === 'web') {
    const xlsxMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    try {
      const ws = buildGroupedWorksheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws as XLSX.WorkSheet, 'By-Products');
      const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
      if (!buf) throw new Error('empty');
      downloadBlobInBrowser(buf as ArrayBuffer, `${base}.xlsx`, xlsxMime);
      return { rowCount: totalItems, format: 'xlsx' };
    } catch {
      downloadBlobInBrowser('﻿' + groupedToCsv(data), `${base}.csv`, 'text/csv;charset=utf-8');
      return { rowCount: totalItems, format: 'csv' };
    }
  }

  const dir = resolveWritableDir();
  let fileName = `${base}.xlsx`;
  let mime     = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  let fileUri  = `${dir}${fileName}`;
  let usedCsv  = false;

  try {
    const ws = buildGroupedWorksheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws as XLSX.WorkSheet, 'By-Products');
    const b64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
    if (!b64 || typeof b64 !== 'string') throw new Error('empty');
    await writeAsStringAsync(fileUri, b64, { encoding: EncodingType.Base64 });
  } catch {
    usedCsv = true; fileName = `${base}.csv`; mime = 'text/csv';
    fileUri = `${dir}${fileName}`;
    await writeAsStringAsync(fileUri, groupedToCsv(data), { encoding: EncodingType.UTF8 });
  }

  const info = await getInfoAsync(fileUri);
  if (!info.exists || !info.size) throw new Error(`File not written (${fileUri.slice(0, 48)}…)`);

  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) throw new Error('Sharing not available');

  await Sharing.shareAsync(fileUri, { mimeType: mime, dialogTitle: fileName });
  return { rowCount: totalItems, format: usedCsv ? 'csv' : 'xlsx' };
}
