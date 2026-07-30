import type { CurrentUser, EmailsPage, EmailStatus, Stats } from '../types';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message || `request failed with status ${status}`);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...init,
    credentials: 'include', // ส่ง session cookie (httpOnly) ไปด้วยเสมอ
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError(res.status, text);
  }

  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

interface EmailQuery {
  category?: string;
  priority?: string;
  status?: string;
  limit?: number;
  cursor?: string;
  receivedAfter?: string;
  receivedBefore?: string;
}

export const apiClient = {
  getMe: () => request<CurrentUser>('/auth/me'),

  logout: () => request<void>('/auth/logout', { method: 'POST' }),

  getEmails: (query: EmailQuery = {}) => {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) qs.set(key, String(value));
    }
    const suffix = qs.toString();
    return request<EmailsPage>(`/emails${suffix ? `?${suffix}` : ''}`);
  },

  getStats: () => request<Stats>('/stats'),

  updateEmailStatus: (id: string, status: EmailStatus) =>
    request<void>(`/emails/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  bulkUpdateEmailStatus: (ids: string[], status: EmailStatus) =>
    request<void>('/emails/bulk-status', {
      method: 'POST',
      body: JSON.stringify({ ids, status }),
    }),

  loginUrl: () => `${BACKEND_URL}/auth/google`,
};
