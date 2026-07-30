import { gmailMessageUrl } from '../lib/gmail-link';
import type { Email, EmailStatus } from '../types';

const STATUS_OPTIONS: { key: EmailStatus; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'replied', label: 'Replied' },
  { key: 'no_reply_needed', label: 'No reply needed' },
];

const AVATAR_PALETTE = ['#44403c', '#0f766e', '#b45309', '#be123c', '#4d7c0f', '#1d4ed8'];

function parseSender(raw: string): { name: string; email: string } {
  const match = raw.match(/^(.*?)\s*<(.+)>$/);
  if (match) {
    return { name: match[1].trim() || match[2], email: match[2] };
  }
  return { name: raw, email: raw };
}

function avatarColor(name: string): string {
  const sum = [...name].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return AVATAR_PALETTE[sum % AVATAR_PALETTE.length];
}

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
      <path d="M3.5 6.5l8.5 6.5 8.5-6.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M18 13v6a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 3h6v6M10 14L21 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function DetailPanel({
  email,
  userEmail,
  onStatusChange,
}: {
  email: Email | null;
  userEmail: string;
  onStatusChange: (id: string, status: EmailStatus) => void;
}) {
  if (!email) {
    return (
      <aside className="detail-panel detail-panel--empty">
        <div className="detail-panel__empty-icon">
          <MailIcon />
        </div>
        <p className="detail-panel__empty-title">เลือกอีเมลทางซ้ายเพื่อดูรายละเอียด</p>
        <p className="detail-panel__empty-hint">
          รายละเอียด ผลวิเคราะห์ priority และลิงก์เปิดใน Gmail จะแสดงที่นี่
        </p>
      </aside>
    );
  }

  const { name, email: senderEmail } = parseSender(email.sender);
  const priority = email.classification?.priority;
  const category = email.classification?.category;

  return (
    <aside className="detail-panel">
      <div className="detail-panel__header">
        <div className="detail-panel__avatar" style={{ background: avatarColor(name) }}>
          {name.trim().charAt(0).toUpperCase() || '?'}
        </div>
        <div className="detail-panel__header-text">
          <p className="detail-panel__sender">{name}</p>
          <p className="detail-panel__email">{senderEmail}</p>
        </div>
      </div>

      {(priority || category) && (
        <div className="detail-panel__tags">
          {priority && <span className={`priority-chip priority-chip--${priority}`}>{priority}</span>}
          {category && <span className="detail-panel__category-chip">{category}</span>}
        </div>
      )}

      <div className="detail-panel__body">
        <p className="detail-panel__subject">{email.subject}</p>
        <p className="detail-panel__snippet">{email.snippet}</p>
      </div>

      <a
        className="detail-panel__gmail-link"
        href={gmailMessageUrl(userEmail, email.gmailMessageId)}
        target="_blank"
        rel="noreferrer"
      >
        เปิดใน Gmail
        <ExternalLinkIcon />
      </a>

      <div className="detail-panel__status-label">Status</div>
      <div className="detail-panel__status-options">
        {STATUS_OPTIONS.map((opt) => (
          <label
            key={opt.key}
            className={[
              'detail-panel__status-option',
              email.status === opt.key ? 'detail-panel__status-option--active' : '',
            ].join(' ')}
          >
            <input
              type="radio"
              name="status"
              checked={email.status === opt.key}
              onChange={() => onStatusChange(email.id, opt.key)}
            />
            {opt.label}
          </label>
        ))}
      </div>
    </aside>
  );
}
