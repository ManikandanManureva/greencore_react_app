import * as XLSX from 'xlsx';
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
        }>;
      }
    >;
  }
>;

function buildFlatRows(grouped: LogsAllGrouped): Record<string, string | number>[] {
  const rows: Record<string, string | number>[] = [];
  for (const st of Object.values(grouped)) {
    for (const sl of Object.values(st.subLines)) {
      for (const log of sl.logs) {
        rows.push({
          ID: log.id,
          'Recorded at': log.createdAt,
          'Station code': st.stationCode,
          Station: st.stationName,
          'Sub-line': sl.subLine,
          'Material type': log.materialType,
          Shift: log.shiftType,
          'Shift ID': log.shiftId,
          Operator: log.operatorName,
          'Weight (kg)': log.weight,
          Status: log.status,
          'Input QR': log.inputBagQr ?? '',
          'Output QR': log.outputBagQr ?? '',
          Remark: log.remark ?? '',
        });
      }
    }
  }
  rows.sort((a, b) =>
    String(b['Recorded at']).localeCompare(String(a['Recorded at'])),
  );
  return rows;
}

function rowsToCsv(rows: Record<string, string | number>[]): string {
  const headers = [
    'ID',
    'Recorded at',
    'Station code',
    'Station',
    'Sub-line',
    'Material type',
    'Shift',
    'Shift ID',
    'Operator',
    'Weight (kg)',
    'Status',
    'Input QR',
    'Output QR',
    'Remark',
  ];
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

function resolveWritableDir(): string {
  const doc = documentDirectory;
  const cache = cacheDirectory;
  const raw = doc || cache;
  if (!raw) {
    throw new Error('No writable app directory (document/cache)');
  }
  return raw.endsWith('/') ? raw : `${raw}/`;
}

/**
 * Browser download path used when running on Expo Web.
 * `expo-file-system` and `expo-sharing` are no-ops on web, so we build a Blob
 * and trigger a download via a temporary anchor element instead.
 */
function downloadBlobInBrowser(
  data: BlobPart,
  fileName: string,
  mime: string,
): void {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  // Anchor must be in the DOM in some browsers (Firefox) for click() to fire.
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke so the browser has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Writes transactions to a file and opens the OS share sheet (native) or
 * triggers a browser download (Expo Web).
 * Uses .xlsx when SheetJS works; falls back to .csv (opens in Excel/Sheets) if XLSX fails on device.
 */
export async function shareProductionLogsAsXlsx(
  grouped: LogsAllGrouped,
  filenameBase: string,
): Promise<{ rowCount: number; format: 'xlsx' | 'csv' }> {
  const rows = buildFlatRows(grouped);
  const base = filenameBase.replace(/[^a-zA-Z0-9._-]+/g, '_');

  // ── Web (Expo Web) branch ─────────────────────────────────────────────
  // expo-file-system / expo-sharing don't work in browsers — drop a Blob
  // via an anchor download instead. Same XLSX/CSV fallback behavior.
  if (Platform.OS === 'web') {
    const xlsxName = `${base}.xlsx`;
    const xlsxMime =
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    try {
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Transactions');
      const arrayBuf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
      if (!arrayBuf) {
        throw new Error('XLSX export returned empty data');
      }
      downloadBlobInBrowser(arrayBuf as ArrayBuffer, xlsxName, xlsxMime);
      return { rowCount: rows.length, format: 'xlsx' };
    } catch {
      const csvName = `${base}.csv`;
      // Add UTF-8 BOM so Excel opens non-ASCII content correctly.
      const csv = '﻿' + rowsToCsv(rows);
      downloadBlobInBrowser(csv, csvName, 'text/csv;charset=utf-8');
      return { rowCount: rows.length, format: 'csv' };
    }
  }

  // ── Native (iOS / Android) branch ─────────────────────────────────────
  const dir = resolveWritableDir();

  let fileName = `${base}.xlsx`;
  let mime =
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  let fileUri = `${dir}${fileName}`;

  let usedCsv = false;
  try {
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Transactions');
    const b64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
    if (!b64 || typeof b64 !== 'string') {
      throw new Error('XLSX export returned empty data');
    }
    await writeAsStringAsync(fileUri, b64, {
      encoding: EncodingType.Base64,
    });
  } catch {
    usedCsv = true;
    fileName = `${base}.csv`;
    mime = 'text/csv';
    fileUri = `${dir}${fileName}`;
    const csv = rowsToCsv(rows);
    await writeAsStringAsync(fileUri, csv, {
      encoding: EncodingType.UTF8,
    });
  }

  const info = await getInfoAsync(fileUri);
  if (!info.exists || !info.size) {
    throw new Error(
      `File was not written (${Platform.OS}, ${fileUri.slice(0, 48)}…)`,
    );
  }

  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) {
    throw new Error('Sharing is not available on this device');
  }

  await Sharing.shareAsync(fileUri, {
    mimeType: mime,
    dialogTitle: fileName,
  });

  return { rowCount: rows.length, format: usedCsv ? 'csv' : 'xlsx' };
}

