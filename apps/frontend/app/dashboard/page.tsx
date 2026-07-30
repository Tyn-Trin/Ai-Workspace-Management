'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DetailPanel } from '../../components/DetailPanel';
import { EmailList } from '../../components/EmailList';
import { Sidebar } from '../../components/Sidebar';
import { SyncErrorBanner } from '../../components/SyncErrorBanner';
import { UndoToast } from '../../components/UndoToast';
import { useAuth } from '../../hooks/useAuth';
import { useEmails } from '../../hooks/useEmails';
import { useStats } from '../../hooks/useStats';
import { useSyncError } from '../../hooks/useSyncError';
import { apiClient } from '../../lib/api-client';
import type { Category, EmailStatus, Priority } from '../../types';

const STATUS_LABEL: Record<EmailStatus, string> = {
  pending: 'Pending',
  replied: 'Replied',
  no_reply_needed: 'No reply needed',
};

interface UndoState {
  emailId: string;
  previousStatus: EmailStatus;
  newStatus: EmailStatus;
}

export default function DashboardPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [priorityFilter, setPriorityFilter] = useState<Priority | undefined>();
  const [categoryFilter, setCategoryFilter] = useState<Category | undefined>();
  const [dateFrom, setDateFrom] = useState<string | undefined>();
  const [dateTo, setDateTo] = useState<string | undefined>();
  const [showResolved, setShowResolved] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [undoState, setUndoState] = useState<UndoState | null>(null);

  const filters = useMemo(
    () => ({
      priority: priorityFilter,
      category: categoryFilter,
      // ปิด (default) = โชว์แค่ pending, เปิด = โชว์ทุกสถานะปนกัน (resolved แสดงจางลง)
      status: showResolved ? undefined : 'pending',
      receivedAfter: dateFrom,
      receivedBefore: dateTo,
    }),
    [priorityFilter, categoryFilter, showResolved, dateFrom, dateTo],
  );
  const { emails, loadingMore, hasMore, loadMore, updateStatus } = useEmails(filters);
  const stats = useStats();
  const syncError = useSyncError();

  const selectedEmail = emails.find((e) => e.id === selectedId) ?? null;

  const handleStatusChange = useCallback(
    async (emailId: string, status: EmailStatus) => {
      const previousStatus = emails.find((e) => e.id === emailId)?.status;
      await updateStatus(emailId, status);
      // เปลี่ยนเป็น resolved (ไม่ใช่ pending) → เก็บไว้ให้ undo ได้ 5 วิ (แถวจะหายจาก
      // pending view ทันทีตาม default filter ถ้ายังไม่ได้เปิด showResolved)
      if (status !== 'pending' && previousStatus) {
        setUndoState({ emailId, previousStatus, newStatus: status });
      }
    },
    [emails, updateStatus],
  );

  if (!authLoading && !user) {
    router.replace('/login');
    return null;
  }

  if (authLoading) {
    return (
      <main className="dashboard-page dashboard-page--loading">
        <p>Loading...</p>
      </main>
    );
  }

  return (
    <div className="dashboard-page">
      <SyncErrorBanner error={syncError} />
      <div className="dashboard-shell">
        <Sidebar
          stats={stats}
          priorityFilter={priorityFilter}
          categoryFilter={categoryFilter}
          dateFrom={dateFrom}
          dateTo={dateTo}
          onPriorityChange={setPriorityFilter}
          onCategoryChange={setCategoryFilter}
          onDateFromChange={setDateFrom}
          onDateToChange={setDateTo}
          userEmail={user?.email ?? ''}
          onLogout={() => apiClient.logout().then(() => router.replace('/login'))}
        />
        <EmailList
          emails={emails}
          selectedId={selectedId}
          onSelect={setSelectedId}
          hasMore={hasMore}
          loadingMore={loadingMore}
          onLoadMore={loadMore}
          showResolved={showResolved}
          onShowResolvedChange={setShowResolved}
        />
        <DetailPanel email={selectedEmail} userEmail={user?.email ?? ''} onStatusChange={handleStatusChange} />
      </div>

      {undoState && (
        <UndoToast
          message={`Marked as ${STATUS_LABEL[undoState.newStatus]}`}
          onUndo={() => handleStatusChange(undoState.emailId, undoState.previousStatus)}
          onDismiss={() => setUndoState(null)}
        />
      )}
    </div>
  );
}
