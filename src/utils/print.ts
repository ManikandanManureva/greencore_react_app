import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  NetPrinter,
  BLEPrinter,
} from 'react-native-thermal-receipt-printer';
import { t } from './i18n';

const PRINTER_STORAGE_KEY = 'selected_printer';

export const printService = {
  // Discover and select a printer
  selectPrinter: async () => {
    // 1. If we are in a web browser, we cannot use native thermal discovery
    if (Platform.OS === 'web') {
      console.log('Running in browser: Using system print dialog.');
      return { name: 'System Printer (Browser)' };
    }

    try {
      // 2. Robust defensive checks for native modules (Mobile only)
      const netModule = typeof NetPrinter !== 'undefined' ? NetPrinter : null;
      const bleModule = typeof BLEPrinter !== 'undefined' ? BLEPrinter : null;

      let netPrinters: any[] = [];
      let blePrinters: any[] = [];

      if (netModule && netModule.getDeviceList) {
        console.log('Discovering network printers...');
        try {
          if (typeof netModule.init === 'function') {
            await netModule.init();
            await new Promise(resolve => setTimeout(resolve, 200));
          }
          const list = await netModule.getDeviceList();
          netPrinters = Array.isArray(list) ? list : [];
        } catch (e) {
          console.warn('Network discovery failed', e);
          netPrinters = [];
        }
      }

      if (bleModule && bleModule.getDeviceList) {
        console.log('Discovering Bluetooth printers...');
        try {
          if (typeof bleModule.init === 'function') {
            await bleModule.init();
            await new Promise(resolve => setTimeout(resolve, 200));
          }
          const list = await bleModule.getDeviceList();
          blePrinters = Array.isArray(list) ? list : [];
        } catch (e: any) {
          console.warn('Bluetooth discovery failed', e);
          if (e.message && e.message.includes('not enabled')) {
            // We can handle specific message here if needed
          }
          blePrinters = [];
        }
      }

      // Fallback to System Selector for iOS/Mobile if direct thermal fails
      const hasNetPrinters = Array.isArray(netPrinters) && netPrinters.length > 0;
      const hasBlePrinters = Array.isArray(blePrinters) && blePrinters.length > 0;

      if (Platform.OS === 'ios' && !hasNetPrinters && !hasBlePrinters) {
        try {
          console.log('No direct printers found, checking for AirPrint...');
          const printer = await Print.selectPrinterAsync();
          if (printer) {
            await AsyncStorage.setItem(PRINTER_STORAGE_KEY, JSON.stringify({ ...printer, type: 'airprint' }));
            return printer;
          }
        } catch (e) {
          console.warn('AirPrint selection failed', e);
        }
      } else if (Platform.OS === 'android' && !hasNetPrinters && !hasBlePrinters) {
        console.log('No direct thermal printers found on Android.');
        return { type: 'system_fallback', name: 'Android System Printer' };
      }

      return { net: netPrinters, ble: blePrinters };
    } catch (error) {
      console.error('CRITICAL: Error in selectPrinter:', error);
    }
    return null;
  },

  getSavedPrinter: async () => {
    try {
      const saved = await AsyncStorage.getItem(PRINTER_STORAGE_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      return null;
    }
  },

  // Silent Direct Print (Bypasses System Dialog)
  printDirect: async (data: any, printer: any) => {
    // 1. If we are in a web browser, we must use the standard print logic
    if (Platform.OS === 'web') {
      return false; // Force fallback to printQRLabel
    }

    try {
      let printerInterface: any;

      if (printer.type === 'wifi' || printer.host) {
        if (typeof NetPrinter === 'undefined') {
          console.warn('NetPrinter native module not available');
          return false;
        }
        printerInterface = NetPrinter;
        await NetPrinter.init();
        await NetPrinter.connectPrinter(printer.host || printer.url, 9100);
      } else if (printer.type === 'ble' || printer.inner_mac_address) {
        if (typeof BLEPrinter === 'undefined') {
          console.warn('BLEPrinter native module not available');
          return false;
        }
        printerInterface = BLEPrinter;
        await BLEPrinter.init();
        await BLEPrinter.connectPrinter(printer.inner_mac_address);
      } else {
        return false;
      }

      // Standard ESC/POS Commands
      const commands =
        `[C]<b><font size='big'>${t('print.companyName')}</font></b>\n` +
        `[C]--------------------------------\n` +
        `[C]<qrcode size='5'>${data.qrCode}</qrcode>\n` +
        `[C]<b>${data.qrCode}</b>\n` +
        `[L]\n` +
        `[L]<b>${t('print.weightLabel')}:</b> ${data.weight} kg\n` +
        `[L]<b>${t('print.stationLabel')}:</b> ${data.station}\n` +
        `[L]<b>${t('print.lineLabel')}:</b> ${data.line || t('print.notAvailable')}\n` +
        `[L]<b>${t('print.dateLabel')}:</b> ${data.date}\n` +
        `[L]\n` +
        `[C]--------------------------------\n` +
        `[L]\n\n\n`;

      if (printerInterface && printerInterface.printRawData) {
        await printerInterface.printRawData(commands);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Direct print failed, falling back to system dialog:', error);
      return false;
    }
  },

  printQRLabel: async (data: any) => {
    // Label design for 100mm x 150mm paper (portrait). Select this size in the print dialog when printing.
    const html = `
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=100mm, height=150mm, initial-scale=1" />
          <style>
            * { box-sizing: border-box; }
            @page {
              size: 100mm 150mm;
              margin: 0;
            }
            @media print {
              html, body { width: 100mm; height: 150mm; margin: 0; padding: 0; overflow: hidden; }
              .label-container { box-shadow: none !important; }
            }
            html, body {
              font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
              width: 100mm;
              min-width: 100mm;
              height: 150mm;
              min-height: 150mm;
              margin: 0;
              padding: 0;
              overflow: hidden;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            .label-container {
              width: 94mm;
              height: 144mm;
              max-width: 94mm;
              max-height: 144mm;
              border: 1px solid #000;
              padding: 6mm;
              text-align: center;
              border-radius: 2px;
              display: flex;
              flex-direction: column;
              justify-content: space-between;
              flex-shrink: 0;
            }
            .company-name {
              font-size: 16px;
              font-weight: bold;
              text-transform: uppercase;
              margin: 0 0 6px 0;
              border-bottom: 2px solid #000;
              padding-bottom: 4px;
              line-height: 1.2;
            }
            .qr-wrap {
              flex: 1;
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 58mm;
            }
            .qr-wrap img {
              width: 58mm;
              height: 58mm;
              max-width: 100%;
              object-fit: contain;
              display: block;
              margin: 0 auto;
            }
            .qr-id {
              font-size: 20px;
              font-weight: 900;
              background-color: #000;
              color: #fff;
              padding: 6px 8px;
              margin: 8px 0;
              letter-spacing: 1px;
              line-height: 1.2;
            }
            .info-grid {
              width: 100%;
              display: flex;
              flex-wrap: wrap;
              justify-content: space-between;
              margin-top: 6px;
              gap: 4px 0;
            }
            .info-item {
              width: 48%;
              text-align: left;
              margin-bottom: 4px;
            }
            .info-item.right { text-align: right; }
            .info-label {
              font-size: 10px;
              color: #666;
              text-transform: uppercase;
              margin-bottom: 1px;
            }
            .info-value {
              font-size: 12px;
              font-weight: bold;
              color: #000;
            }
            .footer {
              font-size: 9px;
              margin-top: 8px;
              color: #999;
            }
          </style>
        </head>
        <body>
          <div class="label-container">
            <div class="company-name">${t('print.companyName')}</div>
            <div class="qr-wrap">
              ${data.qrImage ? `<img src="data:image/png;base64,${data.qrImage}" alt="QR" />` : `<span>${data.qrCode}</span>`}
            </div>
            <div class="qr-id">${data.qrCode}</div>
            <div class="info-grid">
              <div class="info-item">
                <div class="info-label">${t('print.weightLabel')}</div>
                <div class="info-value">${data.weight} kg</div>
              </div>
              <div class="info-item right">
                <div class="info-label">${t('print.stationLabel')}</div>
                <div class="info-value">${data.station}</div>
              </div>
              <div class="info-item">
                <div class="info-label">${t('print.lineLabel')}</div>
                <div class="info-value">${data.line || t('print.notAvailable')}</div>
              </div>
              <div class="info-item right">
                <div class="info-label">${t('print.dateLabel')}</div>
                <div class="info-value">${data.date}</div>
              </div>
            </div>
            <div class="footer">${t('print.scanToVerify')}</div>
          </div>
        </body>
      </html>
    `;

    try {
      const savedPrinter = await printService.getSavedPrinter();

      if (Platform.OS === 'ios') {
        // On iOS we can use a specific printer if selected
        await Print.printAsync({
          html,
          printerUrl: savedPrinter?.url
        });
      } else {
        // On Android, we always use the system print dialog which handles 
        // both WiFi and saved Bluetooth printers via System Print Services.
        await Print.printAsync({ html });
      }
      return true;
    } catch (error) {
      console.error('Print error:', error);
      // Fallback: if printing fails, offer to share as PDF
      try {
        const { uri } = await Print.printToFileAsync({ html });
        await Sharing.shareAsync(uri, { UTI: '.pdf', mimeType: 'application/pdf' });
        return true;
      } catch (shareError) {
        console.error('Sharing fallback error:', shareError);
        return false;
      }
    }
  },

  printShiftSummary: async (data: any) => {
    const byProducts = Array.isArray(data.byProducts) ? data.byProducts : [];
    const str = (s: unknown) => String(s ?? '');

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      try {
        const { jsPDF } = await import('jspdf');
        const { autoTable } = await import('jspdf-autotable');
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        doc.setFont('helvetica');
        let y = 14;

        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text(t('print.shiftSummary'), 14, y);
        y += 10;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);

        const infoRows: [string, string][] = [
          [t('print.shift'), str(data.shift)],
          [t('print.operator'), str(data.operator)],
          [t('print.date'), str(data.date)],
        ];
        if (data.remark) {
          infoRows.push([t('print.remark'), str(data.remark)]);
        }
        autoTable(doc, {
          body: infoRows,
          showHead: 'never',
          theme: 'plain',
          tableLineWidth: 0,
          margin: { left: 14, right: 14 },
          startY: y,
          tableWidth: 120,
          styles: { fontSize: 10 },
          columnStyles: { 0: { fontStyle: 'bold', cellWidth: 36 } },
        });
        y = (doc as any).lastAutoTable.finalY + 10;

        const byStation = data.byStation as { crusher: { outputs: number; weight: string }; washing: { outputs: number; weight: string }; extrusion: { outputs: number; weight: string } } | undefined;
        if (byStation) {
          const machineRows: [string, string, string][] = [
            [t('print.crusher'), str(byStation.crusher?.outputs ?? 0), str(byStation.crusher?.weight ?? '0.0')],
            [t('print.washing'), str(byStation.washing?.outputs ?? 0), str(byStation.washing?.weight ?? '0.0')],
            [t('print.extrusion'), str(byStation.extrusion?.outputs ?? 0), str(byStation.extrusion?.weight ?? '0.0')],
            [t('print.total'), str(data.totalOutputs), str(data.totalWeight)],
          ];
          autoTable(doc, {
            head: [[t('print.station'), t('print.totalOutputs'), t('print.totalWeight')]],
            body: machineRows,
            showHead: 'firstPage',
            theme: 'plain',
            tableLineWidth: 0.1,
            margin: { left: 14, right: 14 },
            startY: y,
            tableWidth: 'auto',
            styles: { fontSize: 10 },
            headStyles: { fontStyle: 'bold', fillColor: [240, 240, 240] },
            columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
          });
          y = (doc as any).lastAutoTable.finalY + 10;
        } else {
          autoTable(doc, {
            body: [
              [t('print.totalOutputs'), str(data.totalOutputs)],
              [t('print.totalWeight'), str(data.totalWeight)],
            ] as [string, string][],
            showHead: 'never',
            theme: 'plain',
            tableLineWidth: 0,
            margin: { left: 14, right: 14 },
            startY: y,
            tableWidth: 120,
            styles: { fontSize: 10 },
            columnStyles: { 0: { fontStyle: 'bold', cellWidth: 48 } },
          });
          y = (doc as any).lastAutoTable.finalY + 10;
        }

        autoTable(doc, {
          head: [[t('print.product'), t('print.station'), t('print.category'), t('print.weightKg')]],
          body: byProducts.length === 0
            ? [[{ content: t('print.notAvailable'), colSpan: 4, styles: { fontStyle: 'italic', textColor: [100, 100, 100] } }]]
            : byProducts.map((p: any) => [str(p.name), str(p.stationName), str(p.category), str(p.weight)]),
          showHead: 'firstPage',
          theme: 'plain',
          tableLineWidth: 0,
          margin: { left: 14, right: 14 },
          startY: y,
          tableWidth: 'auto',
          styles: { fontSize: 9 },
          headStyles: { fontStyle: 'bold', fillColor: [240, 240, 240], textColor: [0, 0, 0] },
          columnStyles: { 3: { halign: 'right' } },
        });
        y = (doc as any).lastAutoTable.finalY + 10;

        const waste = Array.isArray(data.waste) ? data.waste : [];
        if (waste.length > 0) {
          doc.setFontSize(11);
          doc.setFont('helvetica', 'bold');
          doc.text(t('print.waste'), 14, y);
          y += 8;
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(9);
          const wasteRows = waste.map((w: any) => [str(w.stationName), str(w.subLine), str(w.wasteType), str(w.weight)]);
          autoTable(doc, {
            head: [[t('print.station'), t('print.section'), t('print.wasteType'), t('print.weightKg')]],
            body: wasteRows,
            showHead: 'firstPage',
            theme: 'plain',
            tableLineWidth: 0.1,
            margin: { left: 14, right: 14 },
            startY: y,
            tableWidth: 'auto',
            styles: { fontSize: 9 },
            headStyles: { fontStyle: 'bold', fillColor: [240, 240, 240] },
            columnStyles: { 3: { halign: 'right' } },
          });
          y = (doc as any).lastAutoTable.finalY + 6;
        }

        doc.save('shift-summary.pdf');
        return true;
      } catch (e) {
        console.error('PDF export error:', e);
        return false;
      }
    }

    const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <style>
            @page { size: A4; margin: 14mm; }
            * { box-sizing: border-box; }
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
              font-size: 11pt;
              line-height: 1.4;
              color: #111;
              margin: 0;
              padding: 16px;
              width: 210mm;
              max-width: 210mm;
              min-width: 210mm;
              margin-left: auto;
              margin-right: auto;
            }
            h1 {
              text-align: center;
              font-size: 16pt;
              font-weight: 700;
              border-bottom: 2px solid #222;
              padding-bottom: 8px;
              margin: 0 0 16px 0;
            }
            .info-table {
              width: 100%;
              max-width: 400px;
              border-collapse: collapse;
              margin-bottom: 20px;
            }
            .info-table td {
              padding: 6px 10px 6px 0;
              vertical-align: top;
            }
            .info-table td:first-child {
              width: 100px;
              font-weight: 600;
              color: #333;
            }
            .info-table td:last-child {
              color: #111;
            }
            .stats {
              display: table;
              width: 100%;
              margin-bottom: 20px;
              border-collapse: collapse;
            }
            .stat-box {
              display: table-cell;
              width: 50%;
              padding: 12px 16px;
              border: 1px solid #ccc;
              vertical-align: middle;
              text-align: center;
            }
            .stat-box:first-child { border-right-width: 0; }
            .stat-box h3 {
              margin: 0 0 4px 0;
              font-size: 10pt;
              font-weight: 600;
              color: #555;
              text-transform: uppercase;
              letter-spacing: 0.5px;
            }
            .stat-box .val {
              font-size: 14pt;
              font-weight: 700;
              color: #111;
            }
            .section-title {
              font-size: 12pt;
              font-weight: 700;
              margin: 16px 0 8px 0;
              padding-bottom: 4px;
            }
            .byproducts {
              width: 100%;
              border-collapse: collapse;
              table-layout: fixed;
            }
            .byproducts th, .byproducts td {
              border: 1px solid #ccc;
              padding: 8px 10px;
              text-align: left;
            }
            .byproducts th {
              background: #f0f0f0;
              font-weight: 600;
              font-size: 10pt;
            }
            .byproducts td:nth-child(1) { width: 26%; }
            .byproducts td:nth-child(2) { width: 22%; }
            .byproducts td:nth-child(3) { width: 32%; }
            .byproducts td:nth-child(4) { width: 20%; text-align: right; }
            .byproducts th:nth-child(4) { text-align: right; }
            .byproducts .empty-row td { font-style: italic; color: #666; }
          </style>
        </head>
        <body>
          <h1>${t('print.shiftSummary')}</h1>
          <table class="info-table">
            <tr><td>${t('print.shift')}</td><td>${esc(data.shift)}</td></tr>
            <tr><td>${t('print.operator')}</td><td>${esc(data.operator)}</td></tr>
            <tr><td>${t('print.date')}</td><td>${esc(data.date)}</td></tr>
            ${data.remark ? `<tr><td>${t('print.remark')}</td><td>${esc(data.remark)}</td></tr>` : ''}
          </table>
          ${(data.byStation) ? `
          <div class="section-title">${t('print.byMachine')}</div>
          <table class="byproducts">
            <thead>
              <tr>
                <th>${t('print.byMachine')}</th>
                <th style="text-align:right">${t('print.totalOutputs')}</th>
                <th style="text-align:right">${t('print.totalWeight')}</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>${t('print.crusher')}</td><td style="text-align:right">${esc(data.byStation.crusher?.outputs ?? 0)}</td><td style="text-align:right">${esc(data.byStation.crusher?.weight ?? '0.0')}</td></tr>
              <tr><td>${t('print.washing')}</td><td style="text-align:right">${esc(data.byStation.washing?.outputs ?? 0)}</td><td style="text-align:right">${esc(data.byStation.washing?.weight ?? '0.0')}</td></tr>
              <tr><td>${t('print.extrusion')}</td><td style="text-align:right">${esc(data.byStation.extrusion?.outputs ?? 0)}</td><td style="text-align:right">${esc(data.byStation.extrusion?.weight ?? '0.0')}</td></tr>
              <tr style="font-weight:700"><td>${t('print.total')}</td><td style="text-align:right">${esc(data.totalOutputs)}</td><td style="text-align:right">${esc(data.totalWeight)}</td></tr>
            </tbody>
          </table>
          ` : `
          <div class="stats">
            <div class="stat-box">
              <h3>${t('print.totalOutputs')}</h3>
              <div class="val">${esc(data.totalOutputs)}</div>
            </div>
            <div class="stat-box">
              <h3>${t('print.totalWeight')}</h3>
              <div class="val">${esc(data.totalWeight)}</div>
            </div>
          </div>
          `}
          <div class="section-title">${t('print.byProducts')}</div>
          <table class="byproducts">
            <thead>
              <tr>
                <th>${t('print.product')}</th>
                <th>${t('print.station')}</th>
                <th>${t('print.category')}</th>
                <th>${t('print.weightKg')}</th>
              </tr>
            </thead>
            <tbody>
              ${byProducts.length === 0
        ? `<tr class="empty-row"><td colspan="4">${t('print.notAvailable')}</td></tr>`
        : byProducts.map((p: any) => `
                <tr>
                  <td>${esc(p.name)}</td>
                  <td>${esc(p.stationName)}</td>
                  <td>${esc(p.category)}</td>
                  <td>${esc(p.weight)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          ${(data.waste && data.waste.length > 0) ? `
          <div class="section-title">${t('print.waste')}</div>
          <table class="byproducts">
            <thead>
              <tr>
                <th>${t('print.station')}</th>
                <th>${t('print.section')}</th>
                <th>${t('print.wasteType')}</th>
                <th>${t('print.weightKg')}</th>
              </tr>
            </thead>
            <tbody>
              ${(data.waste as any[]).map((w: any) => `
                <tr>
                  <td>${esc(w.stationName)}</td>
                  <td>${esc(w.subLine)}</td>
                  <td>${esc(w.wasteType)}</td>
                  <td>${esc(w.weight)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          ` : ''}
        </body>
      </html>
    `;

    try {
      if (Platform.OS === 'ios') {
        await Print.printAsync({ html });
      } else {
        const { uri } = await Print.printToFileAsync({ html });
        await Sharing.shareAsync(uri, { UTI: '.pdf', mimeType: 'application/pdf' });
      }
      return true;
    } catch (error) {
      console.error('Print summary error:', error);
      return false;
    }
  }
};
