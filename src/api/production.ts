import client from './client';
import { ProductionLog } from '../types';

export const productionApi = {
  getStations: () => client.get('/production/stations'),
  getMaterials: () => client.get('/production/materials'),
  startShift: (lineId: number, shiftTypeId: number) =>
    client.post('/production/start-shift', { lineId, shiftTypeId }),
  endShift: (shiftId: number, remark?: string, waste?: { stationId: number; subLine: string; wasteType: string; weight: number }[]) =>
    client.post(`/production/end-shift/${shiftId}`, { remark: remark ?? undefined, waste: waste ?? undefined }),
  getClosedShifts: (limit?: number) =>
    client.get('/production/closed-shifts', { params: limit != null ? { limit } : {} }),
  getClosedShiftSummary: (shiftId: number) =>
    client.get(`/production/closed-shift/${shiftId}/summary`),
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
  getByProducts: (shiftId: number) =>
    client.get(`/production/shift/${shiftId}/by-products`),
  updateByProducts: (shiftId: number, byProducts: any[]) =>
    client.put(`/production/shift/${shiftId}/by-products`, { byProducts }),
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
  updateLogStatus: (outputBagQr: string, status: string, washingLine?: string, extrusionLine?: string, usedLine?: string) => {
    const body: any = { outputBagQr, status };
    if (usedLine) {
      body.usedLine = usedLine;
    } else if (washingLine) {
      body.washingLine = washingLine;
    } else if (extrusionLine) {
      body.extrusionLine = extrusionLine;
    }
    return client.put('/production/update-log-status', body);
  },
  updateLogWeight: (logId: number, weight: number) => {
    return client.put('/production/update-log-weight', { logId, weight });
  },
};

export const masterDataApi = {
  getLines: () => client.get('/production/lines'),
  getShifts: () => client.get('/production/shifts'),
};
