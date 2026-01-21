export interface User {
  id: number;
  employeeId: string;
  name: string;
  email: string;
  role: string;
  lastLoginAt?: string;
}

export interface ProductionLine {
  id: number;
  name: string;
  description: string;
  color?: string;
}

export interface Shift {
  id: number;
  name: string;
  start_time: string;
  end_time: string;
}

export interface Station {
  id: number;
  name: string;
  description: string;
  icon: string;
  color: string;
  status?: string;
  statusDesc?: string;
  byProducts?: string[];
  inputType?: string;
  outputType?: string;
}

export interface ProductionLog {
  id: number;
  shift_id: number;
  station_id: number;
  input_bag_qr?: string;
  output_bag_qr: string;
  weight: number;
  status: string;
  created_at: string;
}
