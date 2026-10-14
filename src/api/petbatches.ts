import client from './client';

export type PetStationKey = 'crushing' | 'washing' | 'flakes_sorting' | 'extrusion';

export interface PetBatch {
  id: number;
  batch_no: string;
  region: string;
  region_code: string;
  batch_date: string;
  running_number: number;
  createdBy?: string | null;
  createdAt?: string;
}

export interface PetBatchSession {
  id: number;
  batch_id: number;
  station_key: PetStationKey;
  started_at: string;
  startedBy?: string | null;
  ended_at?: string | null;
  endedBy?: string | null;
  batch_no?: string;
  region?: string;
  region_code?: string;
}

/** A jumbo bag as shown in traceability views. */
export interface TraceBag {
  id: number;
  output_bag_qr: string;
  input_bag_qr?: string | null;
  weight: number | string;
  status?: string | null;
  sub_line?: string | null;
  used_line?: string | null;
  used_datetime?: string | null;
  pet_batch_no?: string | null;
  remark?: string | null;
  created_at: string;
  station_name?: string | null;
  material_type_name?: string | null;
  operator_name?: string | null;
}

export interface PetBatchDetail extends PetBatch {
  delivery_notes: string[];
  sessions: PetBatchSession[];
  raw_material: any[];
  bags: TraceBag[];
}

export interface TraceResult {
  type: 'bag' | 'batch';
  code: string;
  bag: TraceBag | null;
  /** Upstream bags, nearest parent first (e.g. Washing bag, then the Crushing bag it came from). */
  lineage: TraceBag[];
  /** Bags that consumed this one — its current state downstream. */
  downstream: TraceBag[];
  batch: PetBatchDetail | null;
  message?: string;
}

export interface DeliveryNoteOption {
  id: number;
  deliveryNote: string;
  netWeight?: number | string | null;
  supplier?: string | null;
  truckId?: string | null;
  entrydate?: string | null;
  region?: string | null;
  quantity?: number | string | null;
  used_in_batches?: string | null;
}

export const PET_REGIONS = [
  'Jawa Barat',
  'Jawa Timur',
  'Jawa Tengah',
  'Sumatra',
  'Sulawesi',
  'Bali',
] as const;

export const petBatchesApi = {
  create: (region: string, delivery_notes: string[]) =>
    client.post('/petbatches', { region, delivery_notes }),
  searchDeliveryNotes: (search?: string) =>
    client.get('/petbatches/delivery-notes', { params: search ? { search } : undefined }),
  selectable: (station: PetStationKey) =>
    client.get('/petbatches/selectable', { params: { station } }),
  myRunning: (station: PetStationKey) =>
    client.get('/petbatches/mine/running', { params: { station } }),
  start: (batchId: number, station: PetStationKey) =>
    client.post(`/petbatches/${batchId}/start`, { station }),
  end: (batchId: number, station: PetStationKey) =>
    client.post(`/petbatches/${batchId}/end`, { station }),
  detail: (batchId: number) => client.get(`/petbatches/${batchId}`),
  /** Accepts a jumbo-bag QR or a batch number (GPET/...). */
  trace: (code: string) => client.get('/petbatches/trace', { params: { code } }),
};
