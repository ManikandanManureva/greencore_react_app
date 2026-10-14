import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  NetPrinter,
  BLEPrinter,
} from 'react-native-thermal-receipt-printer';
import { t } from './i18n';
import { LABEL_LOGO_BASE64 } from './labelLogo';

const PRINTER_STORAGE_KEY = 'selected_printer';

// Document control block of the PET label form (GRI.F.PD-31) — update here when the form is revised.
const PET_LABEL_DOC_NO = 'GRI.F.PD-31';
const PET_LABEL_REV_NO = '00';
const PET_LABEL_EFFECTIVE_DATE = '03.09.2026';

const PET_LABEL_TITLES: Record<string, string> = {
  crushing: 'CRUSHER',
  washing: 'WASHING',
  flakes_sorting: 'FLAKES SORTING',
  extrusion: 'EXTRUDER',
};

const escHtml = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

async function printLabelHtml(html: string): Promise<boolean> {
  try {
    const savedPrinter = await printService.getSavedPrinter();
    if (Platform.OS === 'ios') {
      await Print.printAsync({ html, printerUrl: savedPrinter?.url });
    } else {
      // Android uses the system print dialog, which handles WiFi and saved Bluetooth printers.
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
}

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
              ${data.qrImage ? `<img src="data:image/png;base64,${data.qrImage}" alt="QR" />` : `<span>${data.qrCode || ''}</span>`}
            </div>
            <div class="qr-id">${data.qrCode || ''}</div>
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

    return printLabelHtml(html);
  },

  /**
   * PET jumbo-bag label — the GRI.F.PD-31 form layout (logo / title / doc control, Quantity,
   * QC Passed, BATCH NUMBER = region batch GPET/..., BAG NUMBER = monthly running number) plus
   * the bag QR. Same 100mm x 150mm stock as printQRLabel so no printer setup changes.
   */
  printPetLabel: async (data: any) => {
    const title =
      PET_LABEL_TITLES[data.petStationKey] ||
      (data.line === 'Final PET' ? 'FINAL PACKING' : String(data.station || '').toUpperCase());
    // Two fixed lines, split after the date (GPET/261014/ | JB/01), so the batch never wraps mid-region.
    const batchHtml = data.petBatchNo
      ? escHtml(data.petBatchNo).replace(/^([^/]+\/\d{6}\/)/, '$1<br />')
      : '&nbsp;';
    // Same rule as Incoming Material net weight: whole numbers without decimals, otherwise 2 places.
    const qtyNum = Number(data.weight);
    const qtyText = Number.isFinite(qtyNum)
      ? Number.isInteger(qtyNum) ? String(qtyNum) : qtyNum.toFixed(2)
      : String(data.weight ?? '');
    const bagNumber = String(data.bagNumber || '');
    const bagFontPt = bagNumber.length <= 4 ? 28 : bagNumber.length <= 6 ? 20 : 15;
    const html = `
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=100mm, height=150mm, initial-scale=1" />
          <style>
            * { box-sizing: border-box; }
            @page { size: 100mm 150mm; margin: 0; }
            html, body {
              width: 100mm; height: 150mm; margin: 0; padding: 0; overflow: hidden;
              font-family: Arial, Helvetica, sans-serif; color: #000;
              -webkit-print-color-adjust: exact; print-color-adjust: exact;
            }
            .label {
              width: 96mm; height: 146mm; margin: 2mm; border: 1.4px solid #000;
              display: flex; flex-direction: column;
            }
            table { width: 100%; border-collapse: collapse; table-layout: fixed; }
            td { border: 1px solid #000; padding: 1mm 1.4mm; vertical-align: middle; }
            .logo { width: 16mm; text-align: center; padding: 1mm; }
            .logo img { width: 14mm; display: block; margin: 0 auto; }
            .title { text-align: center; font-weight: bold; font-size: 10pt; line-height: 1.25; }
            .company { text-align: center; font-weight: bold; font-size: 6.2pt; }
            .doc { width: 33mm; font-size: 6.2pt; line-height: 1.55; padding: 0.6mm 1.2mm; }
            .doc .k { display: inline-block; width: 15mm; }
            .doc .blank { display: inline-block; width: 12mm; border-bottom: 0.8px solid #000; }
            .lbl { text-align: center; font-weight: bold; font-size: 7pt; }
            .qty { font-size: 7pt; }
            .qtyval { text-align: center; font-weight: bold; font-size: 9pt; }
            .qc { height: 18mm; font-size: 7pt; vertical-align: top; }
            .batchval { text-align: center; font-weight: bold; font-size: 12pt; line-height: 1.3; overflow-wrap: anywhere; }
            /* Plain bold, not 900: Windows Chrome swaps in the much wider Arial Black at 900. */
            .bagval { text-align: center; font-weight: bold; white-space: nowrap; }
            .qr { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; }
            .qr img { width: 62mm; height: 62mm; object-fit: contain; }
            .qrtext { font-size: 9pt; font-weight: bold; margin-top: 1.5mm; letter-spacing: 0.3px; }
            .foot { font-size: 7pt; margin-top: 1mm; }
          </style>
        </head>
        <body>
          <div class="label">
            <table>
              <tr>
                <td class="logo" rowspan="2"><img src="data:image/jpeg;base64,${LABEL_LOGO_BASE64}" alt="" /></td>
                <td class="title">LABEL BATCH NUMBER<br />${escHtml(title)}</td>
                <td class="doc" rowspan="2">
                  <div><span class="k">Doc No.</span>: ${PET_LABEL_DOC_NO}</div>
                  <div><span class="k">Rev No.</span>: ${PET_LABEL_REV_NO}</div>
                  <div><span class="k">Effective Date</span>: ${PET_LABEL_EFFECTIVE_DATE}</div>
                  <div><span class="k">Name</span>: <span class="blank"></span></div>
                </td>
              </tr>
              <tr><td class="company">PT. GREENCORE RESOURCES INDONESIA</td></tr>
            </table>
            <table>
              <tr>
                <td class="qty" style="width: 13mm;">Quantity</td>
                <td class="qtyval" style="width: 20mm;">${escHtml(qtyText)} Kg</td>
                <td class="lbl">BATCH NUMBER</td>
                <td class="lbl" style="width: 29mm;">BAG NUMBER</td>
              </tr>
              <tr>
                <td class="qc" colspan="2">QC Passed</td>
                <td class="batchval">${batchHtml}</td>
                <td class="bagval" style="font-size: ${bagFontPt}pt;">${escHtml(bagNumber)}</td>
              </tr>
            </table>
            <div class="qr">
              ${data.qrImage ? `<img src="data:image/png;base64,${data.qrImage}" alt="QR" />` : ''}
              <div class="qrtext">${escHtml(data.qrCode || '')}</div>
              <div class="foot">${escHtml(data.date || '')}</div>
            </div>
          </div>
        </body>
      </html>
    `;
    return printLabelHtml(html);
  },

  printShiftSummary: async (data: any) => {
    const byProducts = Array.isArray(data.byProducts) ? data.byProducts : [];
    const str = (s: unknown) => String(s ?? '');
    const byStation = data.byStation as { crusher: { outputs: number; weight: string }; washing: { outputs: number; weight: string }; extrusion: { outputs: number; weight: string } } | undefined;

    // Build Excel-style per-process data: material movement (input/output/waste) per process
    const getWaste = (processLabel: string, name: string) => {
      const plW = String(processLabel || '').trim();
      const nmW = String(name || '').trim().toLowerCase();
      const p = byProducts.find(
        (x: any) =>
          String(x.processLabel || '').trim() === plW && String(x.name || '').trim().toLowerCase() === nmW,
      );
      return p ? (typeof p.weight === 'number' ? p.weight : Number(p.weight) || 0) : 0;
    };
    /** Sum weights for rows matching any of the process labels and exact waste name (handles legacy wrong processLabel). */
    const sumWasteByProcesses = (processLabels: string[], name: string) => {
      const labels = new Set(processLabels.map((l) => String(l || '').trim()));
      const want = String(name || '').trim().toLowerCase();
      let sum = 0;
      for (const x of byProducts) {
        if (!labels.has(String(x.processLabel || '').trim())) continue;
        if (String(x.name || '').trim().toLowerCase() !== want) continue;
        sum += typeof x.weight === 'number' ? x.weight : Number(x.weight) || 0;
      }
      return sum;
    };
    // Crusher/Remove label: PC uses removeLabelCrushing (Dust Remove Label, Sweep Floor); PE uses crusherWashing (Dust, Sweep Floor)
    const dustRmwKg =
      getWaste('removeLabelCrushing', 'Dust Remove Label') ||
      getWaste('crusherWashing', 'Dust') ||
      getWaste('removeLabelCrushing', 'Dust');
    const sweepCrusherKg =
      getWaste('removeLabelCrushing', 'Sweep Floor') || getWaste('crusherWashing', 'Sweep Floor');
    const processes = [
      {
        key: 'removeLabelCrushing',
        titleKey: 'print.processRemoveLabelCrusher',
        outputKg: byStation ? Number(byStation.crusher?.weight || 0) : 0,
        dustRmwLabelKg: dustRmwKg,
        sweepCrusherKg,
      },
      {
        key: 'washing',
        titleKey: 'print.processBetyWashing',
        outputKg: byStation ? Number(byStation.washing?.weight || 0) : 0,
        wasteKg: getWaste('washing', 'Dust wet') || getWaste('washing', 'Dust'),
      },
      {
        key: 'extrusion',
        titleKey: 'print.processExtrusionReport',
        outputKg: byStation ? Number(byStation.extrusion?.weight || 0) : 0,
        lumpsKg:
          getWaste('extrusion', 'Lumps') ||
          getWaste('boretech', 'Lumps') ||
          sumWasteByProcesses(['extrusion', 'boretech'], 'Lumps'),
        dustExtrKg:
          getWaste('extrusion', 'Dust') ||
          getWaste('boretech', 'Dust') ||
          sumWasteByProcesses(['extrusion', 'boretech'], 'Dust'),
        sweepKg:
          getWaste('extrusion', 'Sweep Floor') ||
          getWaste('boretech', 'Sweep Floor') ||
          sumWasteByProcesses(['extrusion', 'boretech'], 'Sweep Floor'),
      },
    ];

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      try {
        const { jsPDF } = await import('jspdf');
        const { autoTable } = await import('jspdf-autotable');
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        doc.setFont('helvetica');
        let y = 14;

        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text(t('print.ppicReportTitle'), 14, y);
        y += 8;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);

        const infoRows: [string, string][] = [
          [t('print.shift'), str(data.shift)],
          [t('print.operator'), str(data.operator)],
          [t('print.date'), str(data.date)],
        ];
        if (data.remark) {
          infoRows.push([t('print.remarks'), str(data.remark)]);
        }
        autoTable(doc, {
          body: infoRows,
          showHead: 'never',
          theme: 'plain',
          tableLineWidth: 0,
          margin: { left: 14, right: 14 },
          startY: y,
          tableWidth: 120,
          styles: { fontSize: 9 },
          columnStyles: { 0: { fontStyle: 'bold', cellWidth: 28 } },
        });
        y = (doc as any).lastAutoTable.finalY + 8;

        // Excel-style: one table per process (Remove label & Crusher, Washing, Extrusion)
        for (const proc of processes) {
          doc.setFontSize(10);
          doc.setFont('helvetica', 'bold');
          doc.text(t(proc.titleKey), 14, y);
          y += 6;
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(8);

          if (proc.key === 'removeLabelCrushing') {
            const head = [[t('print.shiftCol'), t('print.pic'), t('print.inputKg'), t('print.outputKg'), t('print.yieldPct'), t('print.target'), t('print.effPct'), t('print.dustRmwLabelKg'), t('print.sweepCrusherKg'), t('print.wastePct'), t('print.remarks')]];
            const row = [str(data.shift), str(data.operator), t('print.na'), str(proc.outputKg.toFixed(1)), t('print.na'), t('print.na'), t('print.na'), str(proc.dustRmwLabelKg), str(proc.sweepCrusherKg), '', str(data.remark || '')];
            autoTable(doc, { head, body: [row], showHead: 'firstPage', theme: 'plain', tableLineWidth: 0.05, margin: { left: 14, right: 14 }, startY: y, tableWidth: 'auto', styles: { fontSize: 7 }, headStyles: { fontStyle: 'bold', fillColor: [220, 230, 241] }, columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' }, 9: { halign: 'right' } } });
          } else if (proc.key === 'washing') {
            const head = [[t('print.shiftCol'), t('print.pic'), t('print.inputKg'), t('print.outputKg'), t('print.yieldPct'), t('print.target'), t('print.wasteKg'), t('print.wastePct'), t('print.remarks')]];
            const row = [str(data.shift), str(data.operator), t('print.na'), str(proc.outputKg.toFixed(1)), t('print.na'), t('print.na'), str(proc.wasteKg), '', str(data.remark || '')];
            autoTable(doc, { head, body: [row], showHead: 'firstPage', theme: 'plain', tableLineWidth: 0.05, margin: { left: 14, right: 14 }, startY: y, tableWidth: 'auto', styles: { fontSize: 7 }, headStyles: { fontStyle: 'bold', fillColor: [232, 245, 233] }, columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' } } });
          } else {
            const head = [[t('print.shiftCol'), t('print.pic'), t('print.inputKg'), t('print.outputKg'), t('print.yieldPct'), t('print.target'), 'Lumps (kg)', 'Dust (kg)', t('print.sweepCrusherKg'), t('print.wastePct'), t('print.remarks')]];
            const row = [str(data.shift), str(data.operator), t('print.na'), str(proc.outputKg.toFixed(1)), t('print.na'), t('print.na'), str((proc as any).lumpsKg), str((proc as any).dustExtrKg), str((proc as any).sweepKg), '', str(data.remark || '')];
            autoTable(doc, { head, body: [row], showHead: 'firstPage', theme: 'plain', tableLineWidth: 0.05, margin: { left: 14, right: 14 }, startY: y, tableWidth: 'auto', styles: { fontSize: 7 }, headStyles: { fontStyle: 'bold', fillColor: [255, 243, 224] }, columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' }, 9: { halign: 'right' } } });
          }
          y = (doc as any).lastAutoTable.finalY + 8;
        }

        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.text(`${t('print.total')}: ${str(data.totalOutputs)} ${t('print.totalOutputs')} · ${str(data.totalWeight)} kg`, 14, y);
        y += 6;

        doc.save('ppic-shift-report.pdf');
        return true;
      } catch (e) {
        console.error('PDF export error:', e);
        return false;
      }
    }

    const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const procHtml = processes.map((proc: any) => {
      if (proc.key === 'removeLabelCrushing') {
        return `<div class="process-block" style="background:#e3f2fd;padding:8px 10px;margin-bottom:12px;border-radius:4px;"><div class="section-title">${t('print.processRemoveLabelCrusher')}</div><table class="ppic-table"><thead><tr><th>${t('print.shiftCol')}</th><th>${t('print.pic')}</th><th>${t('print.inputKg')}</th><th>${t('print.outputKg')}</th><th>${t('print.yieldPct')}</th><th>${t('print.target')}</th><th>${t('print.effPct')}</th><th>${t('print.dustRmwLabelKg')}</th><th>${t('print.sweepCrusherKg')}</th><th>${t('print.wastePct')}</th><th>${t('print.remarks')}</th></tr></thead><tbody><tr><td>${esc(data.shift)}</td><td>${esc(data.operator)}</td><td class="num">${t('print.na')}</td><td class="num">${proc.outputKg.toFixed(1)}</td><td class="num">${t('print.na')}</td><td class="num">${t('print.na')}</td><td class="num">${t('print.na')}</td><td class="num">${proc.dustRmwLabelKg}</td><td class="num">${proc.sweepCrusherKg}</td><td class="num"></td><td>${esc(data.remark || '')}</td></tr></tbody></table></div>`;
      }
      if (proc.key === 'washing') {
        return `<div class="process-block" style="background:#e8f5e9;padding:8px 10px;margin-bottom:12px;border-radius:4px;"><div class="section-title">${t('print.processBetyWashing')}</div><table class="ppic-table"><thead><tr><th>${t('print.shiftCol')}</th><th>${t('print.pic')}</th><th>${t('print.inputKg')}</th><th>${t('print.outputKg')}</th><th>${t('print.yieldPct')}</th><th>${t('print.target')}</th><th>${t('print.wasteKg')}</th><th>${t('print.wastePct')}</th><th>${t('print.remarks')}</th></tr></thead><tbody><tr><td>${esc(data.shift)}</td><td>${esc(data.operator)}</td><td class="num">${t('print.na')}</td><td class="num">${proc.outputKg.toFixed(1)}</td><td class="num">${t('print.na')}</td><td class="num">${t('print.na')}</td><td class="num">${proc.wasteKg}</td><td class="num"></td><td>${esc(data.remark || '')}</td></tr></tbody></table></div>`;
      }
      return `<div class="process-block" style="background:#fff3e0;padding:8px 10px;margin-bottom:12px;border-radius:4px;"><div class="section-title">${t('print.processExtrusionReport')}</div><table class="ppic-table"><thead><tr><th>${t('print.shiftCol')}</th><th>${t('print.pic')}</th><th>${t('print.inputKg')}</th><th>${t('print.outputKg')}</th><th>${t('print.yieldPct')}</th><th>${t('print.target')}</th><th>Lumps (kg)</th><th>Dust (kg)</th><th>${t('print.sweepCrusherKg')}</th><th>${t('print.wastePct')}</th><th>${t('print.remarks')}</th></tr></thead><tbody><tr><td>${esc(data.shift)}</td><td>${esc(data.operator)}</td><td class="num">${t('print.na')}</td><td class="num">${proc.outputKg.toFixed(1)}</td><td class="num">${t('print.na')}</td><td class="num">${t('print.na')}</td><td class="num">${proc.lumpsKg}</td><td class="num">${proc.dustExtrKg}</td><td class="num">${proc.sweepKg}</td><td class="num"></td><td>${esc(data.remark || '')}</td></tr></tbody></table></div>`;
    }).join('');
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
            .ppic-table { width: 100%; border-collapse: collapse; font-size: 9pt; }
            .ppic-table th, .ppic-table td { border: 1px solid #999; padding: 5px 6px; text-align: left; }
            .ppic-table th { background: #f5f5f5; font-weight: 600; }
            .ppic-table td.num { text-align: right; }
            .total-line { margin-top: 12px; font-weight: 700; font-size: 10pt; }
          </style>
        </head>
        <body>
          <h1>${t('print.ppicReportTitle')}</h1>
          <table class="info-table">
            <tr><td>${t('print.shift')}</td><td>${esc(data.shift)}</td></tr>
            <tr><td>${t('print.operator')}</td><td>${esc(data.operator)}</td></tr>
            <tr><td>${t('print.date')}</td><td>${esc(data.date)}</td></tr>
            ${data.remark ? `<tr><td>${t('print.remarks')}</td><td>${esc(data.remark)}</td></tr>` : ''}
          </table>
          ${procHtml}
          <div class="total-line">${t('print.total')}: ${esc(data.totalOutputs)} ${t('print.totalOutputs')} · ${esc(data.totalWeight)} kg</div>
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
