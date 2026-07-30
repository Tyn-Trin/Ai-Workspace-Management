import type { Email } from '../types';

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
}

export function EmailList({
  emails,
  selectedId,
  onSelect,
  hasMore,
  loadingMore,
  onLoadMore,
  showResolved,
  onShowResolvedChange,
}: {
  emails: Email[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  showResolved: boolean;
  onShowResolvedChange: (value: boolean) => void;
}) {
  return (
    <div className="email-list-panel">
      <div className="email-list-topbar">
        <input className="email-list-search" placeholder="ค้นหา (ยังไม่เปิดใช้งาน)" disabled />
        <label className="email-list__show-resolved">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => onShowResolvedChange(e.target.checked)}
          />
          Show resolved
        </label>
      </div>

      <div className="email-list">
        {emails.length === 0 && <p className="empty-state">ไม่มีอีเมลตรงกับตัวกรองนี้</p>}

        {emails.map((email) => {
          const priority = email.classification?.priority;
          const resolved = email.status !== 'pending';
          return (
            <div
              key={email.id}
              className={[
                'email-row',
                email.id === selectedId ? 'email-row--selected' : '',
                resolved ? 'email-row--resolved' : '',
              ].join(' ')}
              onClick={() => onSelect(email.id)}
            >
              <div className={`email-row__stripe email-row__stripe--${priority ?? 'none'}`} />
              <div>
                {priority && <span className={`priority-chip priority-chip--${priority}`}>{priority}</span>}
              </div>
              <div className="email-row__category">{email.classification?.category ?? '—'}</div>
              <div className="email-row__main">
                <div className="email-row__sender">{email.sender}</div>
                <div className="email-row__subject">{email.subject}</div>
              </div>
              <div className="email-row__time">{formatTime(email.receivedAt)}</div>
            </div>
          );
        })}

        {hasMore && (
          <button className="email-list__load-more" onClick={onLoadMore} disabled={loadingMore}>
            {loadingMore ? 'กำลังโหลด...' : 'โหลดเพิ่ม'}
          </button>
        )}
      </div>
    </div>
  );
}
