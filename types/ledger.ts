export type PaymentMode = 'CASH' | 'CHEQUE';
export type MilestoneStatus = 'PAID' | 'PARTIALLY_PAID' | 'PENDING';

export interface PaymentEntry {
  mode: PaymentMode;
  chequeNo: string;
  date: string; // YYYY-MM-DD
  amount: number;
}

export interface PaymentMilestone {
  name: string;
  amount: number; // Editable by Committee
  amountPaid: number; // Sum of paymentInfo[].amount
  status: MilestoneStatus;
  paymentInfo: PaymentEntry[]; // Expandable list of payments for this stage
  remark: string; // Viewable on all devices, editable by Committee
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