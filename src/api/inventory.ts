import client from './client';

/** A gate-entry (raw_material) record. */
export interface RawMaterial {
  id: number;
  refId?: string | null;
  entrydate?: string | null;
  entrytime?: string | null;
  exitdate?: string | null;
  exittime?: string | null;
  truckId?: string | null;
  supplier?: string | null;
  materialType?: string | null;
  entryWeight?: number | null;
  exitWeight?: number | null;
  netWeight?: number | null;
  deliveryNote?: string | null;
  notes?: string | null;
  quantity?: number | null;
  status?: string | null;
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
  materialDescription?: string | null;
  returnentrydate?: string | null;
  returnentrytime?: string | null;
  returnExitDate?: string | null;
  returnExitTime?: string | null;
  returnEntryWeight?: number | null;
  returnExitWeight?: number | null;
  returnNetWeight?: number | null;
  recordNoWBS?: string | null;
  plant?: string | null;
}

export interface RawMaterialListResponse {
  success: boolean;
  data: RawMaterial[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface InventorySummary {
  total: number;
  pending: number;
  accepted: number;
  rejected: number;
  total_net_weight: number;
}

export const INVENTORY_STATUSES = ['Pending', 'Accepted', 'Rejected'] as const;

export const inventoryApi = {
  /** Paginated, searchable list of gate-entry records. */
  list: (params?: {
    search?: string;
    status?: string;
    operator?: string;
    createdBy?: string;
    date?: string;
    date_start?: string;
    date_end?: string;
    materialType?: string;
    page?: number;
    limit?: number;
  }) => client.get('/inventory/raw-materials', { params }),

  /** Single gate-entry record by id. */
  get: (id: number) => client.get(`/inventory/raw-materials/${id}`),

  /** Counts by status + total net weight. */
  summary: () => client.get('/inventory/summary'),

  /** Create a new gate-entry record. */
  create: (data: Partial<RawMaterial>) =>
    client.post('/inventory/raw-materials', data),

  /** Update an existing gate-entry record. */
  update: (id: number, data: Partial<RawMaterial>) =>
    client.put(`/inventory/raw-materials/${id}`, data),
};
