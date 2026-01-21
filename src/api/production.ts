import client from './client';
import { ProductionLog } from '../types';

export const productionApi = {
  getStations: () => client.get('/production/stations'),
  getMaterials: () => client.get('/production/materials'),
  startShift: (lineId: number, shiftTypeId: number) => 
    client.post('/production/start-shift', { lineId, shiftTypeId }),
  endShift: (shiftId: number) => 
    client.post(`/production/end-shift/${shiftId}`),
  getShiftStatus: (shiftId: number) => 
    client.get(`/production/shift-status/${shiftId}`),
  getShiftLogs: (shiftId: number) => 
    client.get(`/production/logs/${shiftId}`),
  getActiveShift: (shiftTypeId?: number) => 
    client.get('/production/active-shift', { params: { shiftTypeId } }),
  getNextQr: (stationId: number, shiftId: number, subLine?: string) => 
    client.get('/production/next-qr', { params: { stationId, shiftId, subLine } }),
  logProduction: (data: any) => 
    client.post('/production/log', data),
  logByProducts: (shiftId: number, byProducts: any[]) => 
    client.post('/production/by-products', { shiftId, byProducts }),
  searchLogs: (query: string, targetStationId?: number, currentStationId?: number, status?: string) => 
    client.get('/production/search-logs', { params: { query, targetStationId, currentStationId, status } }),
  getCrusherLogs: (subLine?: string, date?: string, search?: string, status?: string, page?: number, limit?: number) => {
    const params: any = { date, search, page, limit };
    if (subLine) params.subLine = subLine;
    if (status) params.status = status;
    return client.get('/production/crusher-logs', { params });
  },
  getWashingLogs: (subLine?: string, date?: string, search?: string, status?: string, page?: number, limit?: number) => {
    const params: any = { date, search, page, limit };
    if (subLine) params.subLine = subLine;
    if (status) params.status = status;
    return client.get('/production/washing-logs', { params });
  },
  getExtrusionLogs: (subLine?: string, date?: string, search?: string, status?: string, page?: number, limit?: number) => {
    const params: any = { date, search, page, limit };
    if (subLine) params.subLine = subLine;
    if (status) params.status = status;
    return client.get('/production/extrusion-logs', { params });
  },
  updateLogStatus: (outputBagQr: string, status: string, washingLine?: string, extrusionLine?: string) => {
    const body: any = { outputBagQr, status };
    if (washingLine) {
      body.washingLine = washingLine;
    }
    if (extrusionLine) {
      body.extrusionLine = extrusionLine;
    }
    return client.put('/production/update-log-status', body);
  },
};

export const masterDataApi = {
  getLines: () => client.get('/production/lines'),
  getShifts: () => client.get('/production/shifts'),
};
