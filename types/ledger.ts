export type PaymentMode = 'CASH' | 'CHEQUE' | '';

export interface PaymentMilestone {
  name: string;
  amount: number;
  status: 'PAID' | 'PENDING';
  mode: PaymentMode;
  chequeNo: string;
}

export interface FlatRecord {
  id: string; // "A-001", "B-001"
  wing: 'A' | 'B';
  floor: number;
  floorLabel: string;
  flat_no: string;
  owner_name: string;
  payments: PaymentMilestone[] | null;
  paid: number | null;
  toPay: number | null;
}

export type UserRole = 'Builder' | 'Committee' | 'Owner' | null;

export interface ApiResponse {
  status: 'OK' | 'ERROR';
  role?: UserRole;
  records?: FlatRecord[];
  error?: string;
}