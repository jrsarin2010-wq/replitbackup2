export interface PatientRecord {
  id: number;
  tenantId: number;
  name: string;
  phone: string;
  email?: string | null;
  cpf?: string | null;
  birthDate?: string | null;
  address?: string | null;
  notes?: string | null;
  totalSpent: string;
  createdAt: string;
}

export interface AppointmentRecord {
  id: number;
  patientId: number;
  patientName?: string;
  procedureName?: string | null;
  status: string;
  startsAt: string;
  endsAt: string;
  notes?: string | null;
  price?: string | null;
}

export interface LeadRecord {
  id: number;
  name: string;
  phone: string;
  email?: string | null;
  temperature: string;
  source?: string | null;
  interest?: string | null;
  notes?: string | null;
  status: string;
  lastContactAt?: string | null;
  createdAt: string;
}

export interface ConversationRecord {
  id: number;
  contactPhone: string;
  contactName?: string | null;
  contactType: string;
  status: string;
  lastMessageAt?: string | null;
  lastMessagePreview?: string | null;
  unreadCount: number;
}

export interface MessageRecord {
  id: number;
  content: string;
  direction: string;
  audioUrl?: string | null;
  createdAt: string;
}

export interface TreatmentRecord {
  id: number;
  patientId: number;
  patientName?: string;
  patientPhone?: string;
  description: string;
  procedures?: string;
  totalValue: string;
  paidValue: string;
  paymentMethod?: string | null;
  notes?: string | null;
  status: string;
  finishedAt?: string | null;
  createdAt: string;
}

export interface ProcedureRecord {
  id: number;
  name: string;
  price: string;
  durationMinutes: number;
  active: string;
  description?: string | null;
}

export interface ActivityRecord {
  id: number;
  type: string;
  description: string;
  createdAt: string;
}

export interface ProcedureItem {
  name: string;
  value: string;
}
