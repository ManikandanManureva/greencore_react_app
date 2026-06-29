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

/** Response shape from GET /production/logs-all (`data` field). */
export type LogsAllGrouped = Record<
  string,
  {
    stationName: string;
    stationCode: string;
    subLines: Record<
      string,
      {
        subLine: string;
        logs: Array<{
          id: number;
          createdAt: string;
          weight: number;
          status: string;
          inputBagQr: string | null;
          outputBagQr: string | null;
          remark: string | null;
          operatorName: string;
          materialType: string;
          shiftType: string;
          shiftId: number;
          used_line: string | null;
          used_datetime: string | null;
        }>;
      }
    >;
  }
>;

const COLUMNS = [
  { header: 'S.No',          key: 'S.No',          width: 8  },
  { header: 'Jumbo Bag Id',  key: 'Jumbo Bag Id',  width: 16 },
  { header: 'Date & Time',   key: 'Date & Time',   width: 20 },
  { header: 'Shift',         key: 'Shift',         width: 12 },
  { header: 'Material Type', key: 'Material Type', width: 18 },
  { header: 'Station',       key: 'Station',       width: 20 },
  { header: 'Sub-Line',      key: 'Sub-Line',      width: 14 },
  { header: 'Weight (kg)',   key: 'Weight (kg)',   width: 14 },
  { header: 'Operator',      key: 'Operator',      width: 18 },
  { header: 'Status',        key: 'Status',        width: 14 },
  { header: 'Used Line',      key: 'Used Line',      width: 16 },
  { header: 'Used Date Time', key: 'Used Date Time', width: 20 },
  { header: 'Remarks',        key: 'Remarks',        width: 24 },
] as const;

function formatDate(iso: string): string {
  const d = new Date(iso);
  const dd   = String(d.getDate()).padStart(2, '0');
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh   = String(d.getHours()).padStart(2, '0');
  const min  = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

function buildFlatRows(grouped: LogsAllGrouped): Record<string, string | number>[] {
  const rows: Record<string, string | number>[] = [];
  for (const st of Object.values(grouped)) {
    for (const sl of Object.values(st.subLines)) {
      for (const log of sl.logs) {
        rows.push({
          'Jumbo Bag Id':  log.outputBagQr ?? '',
          'Date & Time':   log.createdAt,
          'Shift':         log.shiftType,
          'Material Type': log.materialType,
          'Station':       st.stationName,
          'Sub-Line':      sl.subLine,
          'Weight (kg)':   log.weight,
          'Operator':      log.operatorName,
          'Status':        log.status,
          'Used Line':      log.used_line ?? '',
          'Used Date Time': log.used_datetime ?? '',
          'Remarks':        log.remark ?? '',
        });
      }
    }
  }
  rows.sort((a, b) =>
    String(b['Date & Time']).localeCompare(String(a['Date & Time'])),
  );
  // Add serial number and format date after sorting
  return rows.map((r, i) => ({
    'S.No':          i + 1,
    'Jumbo Bag Id':  r['Jumbo Bag Id'],
    'Date & Time':   formatDate(String(r['Date & Time'])),
    'Shift':         r['Shift'],
    'Material Type': r['Material Type'],
    'Station':       r['Station'],
    'Sub-Line':      r['Sub-Line'],
    'Weight (kg)':   r['Weight (kg)'],
    'Operator':      r['Operator'],
    'Status':        r['Status'],
    'Used Line':      r['Used Line'],
    'Used Date Time': r['Used Date Time'] ? formatDate(String(r['Used Date Time'])) : '',
    'Remarks':        r['Remarks'],
  }));
}

// ── Styles ──────────────────────────────────────────────────────────────────

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
  border:    {
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

function buildStyledWorksheet(rows: Record<string, string | number>[]) {
  const ws: Record<string, unknown> = {};
  const totalRows    = rows.length;
  const totalCols    = COLUMNS.length;
  const headerRowIdx = 0;

  // Write header row (row 1, index 0)
  COLUMNS.forEach((col, ci) => {
    const addr = XLSX.utils.encode_cell({ r: headerRowIdx, c: ci });
    ws[addr] = { v: col.header, t: 's', s: HEADER_STYLE };
  });

  // Write data rows
  rows.forEach((row, ri) => {
    const excelRow = ri + 1; // row 0 is header
    const baseStyle = ri % 2 === 0 ? ROW_STYLE_EVEN : ROW_STYLE_ODD;

    COLUMNS.forEach((col, ci) => {
      const addr  = XLSX.utils.encode_cell({ r: excelRow, c: ci });
      const value = row[col.key];
      const isNum = col.key === 'S.No' || col.key === 'Weight (kg)';

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

  // Sheet range
  ws['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: totalRows, c: totalCols - 1 },
  });

  // Column widths
  ws['!cols'] = COLUMNS.map((col) => ({ wch: col.width }));

  // Freeze header row
  ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft' };

  return ws;
}

// ── CSV (plain, no styling) ──────────────────────────────────────────────────

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
  const doc   = documentDirectory;
  const cache = cacheDirectory;
  const raw   = doc || cache;
  if (!raw) throw new Error('No writable app directory (document/cache)');
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

export async function shareProductionLogsAsXlsx(
  grouped: LogsAllGrouped,
  filenameBase: string,
): Promise<{ rowCount: number; format: 'xlsx' | 'csv' }> {
  const rows = buildFlatRows(grouped);
  const base = filenameBase.replace(/[^a-zA-Z0-9._-]+/g, '_');

  // ── Web (Expo Web) ─────────────────────────────────────────────────────
  if (Platform.OS === 'web') {
    const xlsxName = `${base}.xlsx`;
    const xlsxMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    try {
      const ws = buildStyledWorksheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws as XLSX.WorkSheet, 'Production Logs');
      const arrayBuf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
      if (!arrayBuf) throw new Error('XLSX export returned empty data');
      downloadBlobInBrowser(arrayBuf as ArrayBuffer, xlsxName, xlsxMime);
      return { rowCount: rows.length, format: 'xlsx' };
    } catch {
      const csvName = `${base}.csv`;
      const csv = '﻿' + rowsToCsv(rows);
      downloadBlobInBrowser(csv, csvName, 'text/csv;charset=utf-8');
      return { rowCount: rows.length, format: 'csv' };
    }
  }

  // ── Native (iOS / Android) ─────────────────────────────────────────────
  const dir = resolveWritableDir();

  let fileName = `${base}.xlsx`;
  let mime     = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  let fileUri  = `${dir}${fileName}`;
  let usedCsv  = false;

  try {
    const ws = buildStyledWorksheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws as XLSX.WorkSheet, 'Production Logs');
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

