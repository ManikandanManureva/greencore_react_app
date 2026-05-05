import client from './client';
import { ProductionLog } from '../types';

export const productionApi = {
  getStations: () => client.get('/production/stations'),
  getMaterials: () => client.get('/production/materials'),
  startShift: (shiftTypeId: number) =>
    client.post('/production/start-shift', { shiftTypeId }),
  endShift: (shiftId: number, remark?: string, waste?: { stationId: number; subLine: string; wasteType: string; weight: number }[]) =>
    client.post(`/production/end-shift/${shiftId}`, { remark: remark ?? undefined, waste: waste ?? undefined }),
  getClosedShifts: (limit?: number, date?: string, shiftTypeId?: number) => {
    const num = shiftTypeId != null ? Number(shiftTypeId) : undefined;
    const validShift = num != null && !Number.isNaN(num) && num >= 1 && num <= 3 ? num : undefined;
    return client.get('/production/closed-shifts', {
      params: {
        ...(limit != null && { limit }),
        ...(date && { date }),
        ...(validShift != null && { shiftTypeId: validShift }),
      },
    });
  },
  getClosedShiftSummary: (shiftId: number) =>
    client.get(`/production/closed-shift/${shiftId}/summary`),
  /** Works for both active and closed shifts — use this for PPIC "view any shift" */
  getShiftSummary: (shiftId: number) =>
    client.get(`/production/shift/${shiftId}/summary`),
  /** Returns all currently running operator sessions (PPIC live view) */
  getAllActiveShifts: () =>
    client.get('/production/active-shifts'),
  updateClosedShiftRemark: (shiftId: number, remark: string) =>
    client.put(`/production/closed-shift/${shiftId}/remark`, { remark }),
  getShiftStatus: (shiftId: number) =>
    client.get(`/production/shift-status/${shiftId}`),
  getLatestShift: () =>
    client.get('/production/latest-shift'),
  getShiftLogs: (shiftId: number) =>
    client.get(`/production/logs/${shiftId}`),
  getActiveShift: (shiftTypeId?: number) =>
    client.get('/production/active-shift', { params: { shiftTypeId } }),
  getNextQr: (stationId: number, shiftId: number, subLine?: string, shiftTypeId?: number) =>
    client.get('/production/next-qr', { params: { stationId, shiftId, subLine, shiftTypeId } }),
  logProduction: (data: any) =>
    client.post('/production/log', data),
  logByProducts: (shiftId: number, byProducts: any[]) =>
    client.post('/production/by-products', { shiftId, byProducts }),
  getByProducts: (shiftId: number) =>
    client.get(`/production/shift/${shiftId}/by-products`),
  updateByProducts: (shiftId: number, byProducts: any[]) =>
    client.put(`/production/shift/${shiftId}/by-products`, { byProducts }),
  searchLogs: (query: string, targetStationId?: number, currentStationId?: number, status?: string, sourceSubLines?: string[], shiftId?: number, forInput?: boolean) =>
    client.get('/production/search-logs', {
      params: {
        query,
        targetStationId,
        currentStationId,
        status,
        ...(sourceSubLines && sourceSubLines.length > 0 && { source_sub_lines: sourceSubLines.join(',') }),
        ...(shiftId && { shift_id: shiftId }),
        ...(forInput && { for_input: '1' }),
      },
    }),
  getCrusherLogs: (subLine?: string, date?: string, search?: string, status?: string, page?: number, limit?: number, shiftId?: number | null) => {
    const params: any = { date, search, page, limit };
    if (subLine) params.subLine = subLine;
    if (status) params.status = status;
    if (shiftId) params.shift_id = shiftId;
    return client.get('/production/crusher-logs', { params });
  },
  getWashingLogs: (subLine?: string, date?: string, search?: string, status?: string, page?: number, limit?: number, shiftId?: number | null) => {
    const params: any = { date, search, page, limit };
    if (subLine) params.subLine = subLine;
    if (status) params.status = status;
    if (shiftId) params.shift_id = shiftId;
    return client.get('/production/washing-logs', { params });
  },
  getExtrusionLogs: (subLine?: string, date?: string, search?: string, status?: string, page?: number, limit?: number, shiftId?: number | null) => {
    const params: any = { date, search, page, limit };
    if (subLine) params.subLine = subLine;
    if (status) params.status = status;
    if (shiftId) params.shift_id = shiftId;
    return client.get('/production/extrusion-logs', { params });
  },
  getFinalPackingLogs: (date?: string, search?: string, status?: string, page?: number, limit?: number, shiftId?: number | null, stationId?: number | null) => {
    const params: any = { date, search, page, limit };
    if (status) params.status = status;
    if (shiftId) params.shift_id = shiftId;
    if (stationId != null) params.station_id = stationId;
    return client.get('/production/final-packing-logs', { params });
  },
  getPpicStationOverview: (date?: string, shiftTypeId?: number | null) => {
    const params: any = { date };
    if (shiftTypeId) params.shift_type_id = shiftTypeId;
    return client.get('/production/ppic-station-overview', { params });
  },
  /** Backoffice-style grouped logs; omit `material_type` to include all materials (PC, PE, PET, …). */
  getLogsAll: (query: {
    date_start: string;
    date_end: string;
    station_code?: string;
    shift_type?: string;
    limit?: number;
  }) => {
    const params: Record<string, string | number> = {
      date_start: query.date_start,
      date_end: query.date_end,
      limit: query.limit ?? 25000,
    };
    if (query.station_code) params.station_code = query.station_code;
    if (query.shift_type) params.shift_type = query.shift_type;
    return client.get('/production/logs-all', { params });
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
  /** Backoffice-style update by log id (PPIC uses this for per-output remark). */
  updateProductionLogFields: (
    logId: number,
    body: {
      weight?: number;
      status?: string;
      sub_line?: string;
      remark?: string | null;
    },
  ) => client.put(`/production/logs-update/${logId}`, body),
};

export const masterDataApi = {
  getLines: () => client.get('/production/lines'),
  getShifts: () => client.get('/production/shifts'),
};
