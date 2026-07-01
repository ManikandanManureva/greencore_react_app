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
import type { RawMaterial } from '../api/inventory';

const COLUMNS = [
  { header: 'S.No',                  key: 'S.No',                  width: 8  },
  { header: 'Delivery Note',         key: 'Delivery Note',         width: 20 },
  { header: 'Ref ID',                key: 'Ref ID',                width: 16 },
  { header: 'Entry Date',            key: 'Entry Date',            width: 14 },
  { header: 'Entry Time',            key: 'Entry Time',            width: 12 },
  { header: 'Exit Date',             key: 'Exit Date',             width: 14 },
  { header: 'Exit Time',             key: 'Exit Time',             width: 12 },
  { header: 'Truck ID',              key: 'Truck ID',              width: 14 },
  { header: 'Supplier',              key: 'Supplier',              width: 22 },
  { header: 'Plant',                 key: 'Plant',                 width: 14 },
  { header: 'Material Type',         key: 'Material Type',         width: 16 },
  { header: 'Material Description',  key: 'Material Description',  width: 26 },
  { header: 'Entry Weight (kg)',      key: 'Entry Weight (kg)',      width: 18 },
  { header: 'Exit Weight (kg)',       key: 'Exit Weight (kg)',       width: 16 },
  { header: 'Net Weight (kg)',        key: 'Net Weight (kg)',        width: 16 },
  { header: 'Notes',                 key: 'Notes',                 width: 26 },
] as const;

// ── Styles (same palette as Production export) ───────────────────────────────

const BORDER_THIN = {
  top:    { style: 'thin', color: { rgb: 'BDBDBD' } },
  bottom: { style: 'thin', color: { rgb: 'BDBDBD' } },
  left:   { style: 'thin', color: { rgb: 'BDBDBD' } },
  right:  { style: 'thin', color: { rgb: 'BDBDBD' } },
};

const HEADER_STYLE = {
  font:      { bold: true, color: { rgb: 'FFFFFF' }, sz: 11, name: 'Calibri' },
  fill:      { fgColor: { rgb: '1B5E20' }, patternType: 'solid' },
  alignment: { horizontal: 'center', vertical: 'center', wrapText: false },
  border: {
    top:    { style: 'medium', color: { rgb: '000000' } },
    bottom: { style: 'medium', color: { rgb: '000000' } },
    left:   { style: 'thin',   color: { rgb: '000000' } },
    right:  { style: 'thin',   color: { rgb: '000000' } },
  },
};

const ROW_STYLE_EVEN = {
  font:      { sz: 10, name: 'Calibri', color: { rgb: '212121' } },
  fill:      { fgColor: { rgb: 'F1F8E9' }, patternType: 'solid' },
  alignment: { vertical: 'center' },
  border:    BORDER_THIN,
};

const ROW_STYLE_ODD = {
  font:      { sz: 10, name: 'Calibri', color: { rgb: '212121' } },
  fill:      { fgColor: { rgb: 'FFFFFF' }, patternType: 'solid' },
  alignment: { vertical: 'center' },
  border:    BORDER_THIN,
};

const SERNO_STYLE_BASE = {
  alignment: { horizontal: 'center', vertical: 'center' },
  border:    BORDER_THIN,
};

function formatDateDMY(date: string | null | undefined): string {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return date;
  const dd   = String(d.getUTCDate()).padStart(2, '0');
  const mm   = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// ── Row builder ──────────────────────────────────────────────────────────────

function buildRows(records: RawMaterial[]): Record<string, string | number>[] {
  // Sort newest entry date first
  const sorted = [...records].sort((a, b) => {
    const da = a.entrydate ?? '';
    const db = b.entrydate ?? '';
    return db.localeCompare(da);
  });

  return sorted.map((r, i) => ({
    'S.No':                 i + 1,
    'Ref ID':               r.refId ?? '',
    'Entry Date':           formatDateDMY(r.entrydate),
    'Entry Time':           r.entrytime ?? '',
    'Exit Date':            formatDateDMY(r.exitdate),
    'Exit Time':            r.exittime ?? '',
    'Truck ID':             r.truckId ?? '',
    'Supplier':             r.supplier ?? '',
    'Plant':                r.plant ?? '',
    'Material Type':        r.materialType ?? '',
    'Material Description': r.materialDescription ?? '',
    'Entry Weight (kg)':    r.entryWeight ?? '',
    'Exit Weight (kg)':     r.exitWeight ?? '',
    'Net Weight (kg)':      r.netWeight ?? '',
    'Delivery Note':        r.deliveryNote ?? '',
    'Notes':                r.notes ?? '',
  }));
}

// ── Worksheet builder ────────────────────────────────────────────────────────

function buildStyledWorksheet(rows: Record<string, string | number>[]) {
  const ws: Record<string, unknown> = {};
  const totalRows = rows.length;
  const totalCols = COLUMNS.length;

  COLUMNS.forEach((col, ci) => {
    const addr = XLSX.utils.encode_cell({ r: 0, c: ci });
    ws[addr] = { v: col.header, t: 's', s: HEADER_STYLE };
  });

  rows.forEach((row, ri) => {
    const excelRow = ri + 1;
    const baseStyle = ri % 2 === 0 ? ROW_STYLE_EVEN : ROW_STYLE_ODD;

    COLUMNS.forEach((col, ci) => {
      const addr  = XLSX.utils.encode_cell({ r: excelRow, c: ci });
      const value = row[col.key];
      const isNum =
        col.key === 'S.No' ||
        col.key === 'Entry Weight (kg)' ||
        col.key === 'Exit Weight (kg)' ||
        col.key === 'Net Weight (kg)';

      const cellStyle =
        col.key === 'S.No'
          ? { ...baseStyle, ...SERNO_STYLE_BASE, font: baseStyle.font }
          : baseStyle;

      ws[addr] = {
        v: value ?? '',
        t: isNum && typeof value === 'number' ? 'n' : 's',
        s: cellStyle,
      };
    });
  });

  ws['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: totalRows, c: totalCols - 1 },
  });
  ws['!cols']   = COLUMNS.map((col) => ({ wch: col.width }));
  ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft' };

  return ws;
}

// ── CSV (plain) ──────────────────────────────────────────────────────────────

function rowsToCsv(rows: Record<string, string | number>[]): string {
  const headers = COLUMNS.map((c) => c.header);
  const esc = (v: string | number) => {
    const s = String(v ?? '');
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push(headers.map((h) => esc(r[h] ?? '')).join(','));
  }
  return lines.join('\n');
}

// ── Utilities ────────────────────────────────────────────────────────────────

function resolveWritableDir(): string {
  const raw = documentDirectory || cacheDirectory;
  if (!raw) throw new Error('No writable app directory');
  return raw.endsWith('/') ? raw : `${raw}/`;
}

function downloadBlobInBrowser(data: BlobPart, fileName: string, mime: string): void {
  const blob = new Blob([data], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Main export ──────────────────────────────────────────────────────────────

export async function shareIncomingMaterialAsXlsx(
  records: RawMaterial[],
  filenameBase: string,
): Promise<{ rowCount: number; format: 'xlsx' | 'csv' }> {
  const rows = buildRows(records);
  const base = filenameBase.replace(/[^a-zA-Z0-9._-]+/g, '_');

  // ── Web ────────────────────────────────────────────────────────────────
  if (Platform.OS === 'web') {
    const xlsxName = `${base}.xlsx`;
    const xlsxMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    try {
      const ws = buildStyledWorksheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws as XLSX.WorkSheet, 'Incoming Material');
      const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
      if (!buf) throw new Error('XLSX export returned empty data');
      downloadBlobInBrowser(buf as ArrayBuffer, xlsxName, xlsxMime);
      return { rowCount: rows.length, format: 'xlsx' };
    } catch {
      const csv = '﻿' + rowsToCsv(rows);
      downloadBlobInBrowser(csv, `${base}.csv`, 'text/csv;charset=utf-8');
      return { rowCount: rows.length, format: 'csv' };
    }
  }

  // ── Native ─────────────────────────────────────────────────────────────
  const dir = resolveWritableDir();
  let fileName = `${base}.xlsx`;
  let mime     = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  let fileUri  = `${dir}${fileName}`;
  let usedCsv  = false;

  try {
    const ws = buildStyledWorksheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws as XLSX.WorkSheet, 'Incoming Material');
    const b64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
    if (!b64 || typeof b64 !== 'string') throw new Error('XLSX export returned empty data');
    await writeAsStringAsync(fileUri, b64, { encoding: EncodingType.Base64 });
  } catch {
    usedCsv  = true;
    fileName = `${base}.csv`;
    mime     = 'text/csv';
    fileUri  = `${dir}${fileName}`;
    await writeAsStringAsync(fileUri, rowsToCsv(rows), { encoding: EncodingType.UTF8 });
  }

  const info = await getInfoAsync(fileUri);
  if (!info.exists || !info.size) {
    throw new Error(`File was not written (${Platform.OS}, ${fileUri.slice(0, 48)}…)`);
  }

  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) throw new Error('Sharing is not available on this device');

  await Sharing.shareAsync(fileUri, { mimeType: mime, dialogTitle: fileName });

  return { rowCount: rows.length, format: usedCsv ? 'csv' : 'xlsx' };
}
