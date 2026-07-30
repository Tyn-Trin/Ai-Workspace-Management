// ค่า union type ด้านล่างต้องตรงกับ apps/ai/app/core/taxonomy.py เสมอ — คนละภาษา
// แชร์ import กันจริงไม่ได้ ถ้าแก้ที่ taxonomy.py ต้องกลับมาแก้ไฟล์นี้ด้วยมือ
export type Category = 'Customer' | 'Internal' | 'Vendor' | 'Meeting' | 'Spam';
export type Priority = 'Urgent' | 'Normal' | 'Low';
export type EmailStatus = 'pending' | 'replied' | 'no_reply_needed';

export interface Classification {
  category: Category;
  priority: Priority;
  reason: string;
}

export interface Email {
  id: string;
  gmailMessageId: string;
  sender: string;
  subject: string;
  snippet: string;
  receivedAt: string;
  status: EmailStatus;
  classification: Classification | null;
}

export interface Stats {
  pending: {
    urgent: number;
    normal: number;
    low: number;
  };
  totalToday: number;
}

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface SyncError {
  message: string;
  at: string;
}

export interface EmailsPage {
  items: Email[];
  nextCursor: string | null;
}
