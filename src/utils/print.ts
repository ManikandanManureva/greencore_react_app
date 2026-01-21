import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  NetPrinter,
  BLEPrinter,
} from 'react-native-thermal-receipt-printer';

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

      let netPrinters = [];
      let blePrinters = [];

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
        `[C]<b><font size='big'>Greencore Resources</font></b>\n` +
        `[C]--------------------------------\n` +
        `[C]<qrcode size='5'>${data.qrCode}</qrcode>\n` +
        `[C]<b>${data.qrCode}</b>\n` +
        `[L]\n` +
        `[L]<b>Weight:</b> ${data.weight} kg\n` +
        `[L]<b>Station:</b> ${data.station}\n` +
        `[L]<b>Line:</b> ${data.line}\n` +
        `[L]<b>Date:</b> ${data.date}\n` +
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
    // Optimized HTML for Thermal Label Printers (Standard 50x30mm or 40x30mm)
    const html = `
      <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no" />
          <style>
            @page { margin: 0; size: auto; }
            body { 
              font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; 
              display: flex; 
              flex-direction: column; 
              align-items: center; 
              justify-content: center; 
              height: 100vh; 
              margin: 0;
              padding: 0;
            }
            .label-container {
              width: 90%;
              max-width: 300px;
              border: 1px solid #000;
              padding: 10px;
              text-align: center;
              border-radius: 4px;
            }
            .company-name {
              font-size: 14px;
              font-weight: bold;
              text-transform: uppercase;
              margin-bottom: 5px;
              border-bottom: 1px solid #eee;
              padding-bottom: 3px;
            }
            .qr-id {
              font-size: 18px;
              font-weight: 900;
              background-color: #000;
              color: #fff;
              padding: 5px;
              margin: 8px 0;
              letter-spacing: 1px;
            }
            .info-grid {
              width: 100%;
              display: flex;
              flex-wrap: wrap;
              justify-content: space-between;
              margin-top: 5px;
            }
            .info-item {
              width: 48%;
              text-align: left;
              margin-bottom: 3px;
            }
            .info-label {
              font-size: 8px;
              color: #666;
              text-transform: uppercase;
            }
            .info-value {
              font-size: 11px;
              font-weight: bold;
              color: #000;
            }
            .footer {
              font-size: 8px;
              margin-top: 10px;
              color: #999;
            }
          </style>
        </head>
        <body>
          <div class="label-container">
            <div class="company-name">Greencore Resources</div>
            
            ${data.qrImage ? `<img src="data:image/png;base64,${data.qrImage}" style="width: 120px; height: 120px; margin: 10px 0;" />` : ''}
            
            <div class="qr-id">${data.qrCode}</div>
            
            <div class="info-grid">
              <div class="info-item">
                <div class="info-label">Weight</div>
                <div class="info-value">${data.weight} kg</div>
              </div>
              <div class="info-item" style="text-align: right;">
                <div class="info-label">Station</div>
                <div class="info-value">${data.station}</div>
              </div>
              <div class="info-item">
                <div class="info-label">Line</div>
                <div class="info-value">${data.line}</div>
              </div>
              <div class="info-item" style="text-align: right;">
                <div class="info-label">Date</div>
                <div class="info-value">${data.date}</div>
              </div>
            </div>
            
            <div class="footer">Scan to verify material provenance</div>
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
    const html = `
      <html>
        <head>
          <style>
            body { font-family: sans-serif; padding: 20px; }
            h1 { text-align: center; border-bottom: 2px solid #333; padding-bottom: 10px; }
            .stats { display: flex; justify-content: space-around; margin: 20px 0; }
            .stat-box { text-align: center; border: 1px solid #ccc; padding: 15px; border-radius: 8px; width: 40%; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { border: 1px solid #ccc; padding: 10px; text-align: left; }
            th { background-color: #f5f5f5; }
          </style>
        </head>
        <body>
          <h1>Shift Summary Report</h1>
          <p><strong>Line:</strong> ${data.line}</p>
          <p><strong>Shift:</strong> ${data.shift}</p>
          <p><strong>Operator:</strong> ${data.operator}</p>
          <p><strong>Date:</strong> ${data.date}</p>
          
          <div class="stats">
            <div class="stat-box">
              <h3>Total Outputs</h3>
              <div>${data.totalOutputs}</div>
            </div>
            <div class="stat-box">
              <h3>Total Weight</h3>
              <div>${data.totalWeight} kg</div>
            </div>
          </div>

          <h3>By-Products</h3>
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Station</th>
                <th>Weight (kg)</th>
              </tr>
            </thead>
            <tbody>
              ${data.byProducts.map((p: any) => `
                <tr>
                  <td>${p.name}</td>
                  <td>${p.stationName}</td>
                  <td>${p.weight}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
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
