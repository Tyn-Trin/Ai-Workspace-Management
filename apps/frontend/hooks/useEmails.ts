'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../lib/api-client';
import { getSocket } from '../lib/ws-client';
import type { Email, EmailStatus } from '../types';

export interface EmailFilters {
  category?: string;
  priority?: string;
  status?: string;
  receivedAfter?: string;
  receivedBefore?: string;
}

const PRIORITY_RANK: Record<string, number> = { Urgent: 0, Normal: 1, Low: 2 };

function sortByPriority(emails: Email[]): Email[] {
  return [...emails].sort((a, b) => {
    const rankA = a.classification ? PRIORITY_RANK[a.classification.priority] : 99;
    const rankB = b.classification ? PRIORITY_RANK[b.classification.priority] : 99;
    return rankA - rankB;
  });
}

export function useEmails(filters: EmailFilters) {
  const [emails, setEmails] = useState<Email[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    apiClient
      .getEmails(filters)
      .then((page) => {
        setEmails(sortByPriority(page.items));
        setNextCursor(page.nextCursor);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.category, filters.priority, filters.status, filters.receivedAfter, filters.receivedBefore]);

  useEffect(() => {
    reload();
  }, [reload]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await apiClient.getEmails({ ...filters, cursor: nextCursor });
      setEmails((prev) => sortByPriority([...prev, ...page.items]));
      setNextCursor(page.nextCursor);
    } finally {
      setLoadingMore(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    filters.category,
    filters.priority,
    filters.status,
    filters.receivedAfter,
    filters.receivedBefore,
    nextCursor,
    loadingMore,
  ]);

  useEffect(() => {
    const socket = getSocket();

    // อีเมลใหม่ classify เสร็จ — โหลดใหม่ทั้งชุด (ง่ายกว่าไล่เช็คว่าตรง filter ปัจจุบันไหมเอง)
    // ทำให้ pagination กลับไปหน้าแรกด้วย ซึ่งโอเคเพราะอีเมลใหม่ล่าสุดควรอยู่หน้าแรกอยู่แล้ว
    const handleClassified = () => reload();

    const handleStatusChanged = (payload: { id: string; status: EmailStatus }) => {
      setEmails((prev) => applyStatusChange(prev, payload.id, payload.status, filters.status));
    };

    socket.on('email:classified', handleClassified);
    socket.on('email:status_changed', handleStatusChanged);

    return () => {
      socket.off('email:classified', handleClassified);
      socket.off('email:status_changed', handleStatusChanged);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload, filters.status]);

  const updateStatus = useCallback(
    async (id: string, status: EmailStatus) => {
      const previous = emails;
      setEmails((prev) => applyStatusChange(prev, id, status, filters.status)); // optimistic
      try {
        await apiClient.updateEmailStatus(id, status);
      } catch (err) {
        setEmails(previous); // ผิดพลาด — คืนค่าเดิม
        throw err;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [emails, filters.status],
  );

  return { emails, loading, loadingMore, hasMore: nextCursor !== null, loadMore, updateStatus, reload };
}

/** อัปเดต status ในลิสต์ที่มีอยู่ — ถ้า status ใหม่ไม่ตรงกับ filter ปัจจุบัน (เช่น mark
 * "replied" ตอน filter อยู่ที่ status=pending) ให้เอาแถวนั้นออกจากลิสต์เลย แทนที่จะค้างโชว์ผิด filter
 */
function applyStatusChange(
  emails: Email[],
  id: string,
  status: EmailStatus,
  activeStatusFilter: string | undefined,
): Email[] {
  if (activeStatusFilter !== undefined && activeStatusFilter !== status) {
    return emails.filter((e) => e.id !== id);
  }
  return emails.map((e) => (e.id === id ? { ...e, status } : e));
}
