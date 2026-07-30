import Image from 'next/image';
import type { Category, Priority, Stats } from '../types';

const PRIORITIES: { key: Priority; color: string }[] = [
  { key: 'Urgent', color: 'var(--color-urgent)' },
  { key: 'Normal', color: 'var(--color-normal)' },
  { key: 'Low', color: 'var(--color-low)' },
];

const CATEGORIES: Category[] = ['Customer', 'Internal', 'Vendor', 'Meeting', 'Spam'];

function totalPending(stats: Stats | null): number | '–' {
  if (!stats) return '–';
  return stats.pending.urgent + stats.pending.normal + stats.pending.low;
}

export function Sidebar({
  stats,
  priorityFilter,
  categoryFilter,
  dateFrom,
  dateTo,
  onPriorityChange,
  onCategoryChange,
  onDateFromChange,
  onDateToChange,
  userEmail,
  onLogout,
}: {
  stats: Stats | null;
  priorityFilter?: Priority;
  categoryFilter?: Category;
  dateFrom?: string;
  dateTo?: string;
  onPriorityChange: (priority: Priority | undefined) => void;
  onCategoryChange: (category: Category | undefined) => void;
  onDateFromChange: (date: string | undefined) => void;
  onDateToChange: (date: string | undefined) => void;
  userEmail: string;
  onLogout: () => void;
}) {
  return (
    <nav className="sidebar">
      <div className="sidebar__logo">
        <Image src="/mail-icon.png" alt="" width={22} height={22} />
        Ai-Mail-priority
      </div>

      <div className="sidebar__section-label">Priority</div>
      {PRIORITIES.map(({ key, color }) => (
        <button
          key={key}
          className={`sidebar__item ${priorityFilter === key ? 'sidebar__item--active' : ''}`}
          onClick={() => onPriorityChange(priorityFilter === key ? undefined : key)}
        >
          <span className="sidebar__item-label">
            <span className="sidebar__dot" style={{ background: color }} />
            {key}
          </span>
          <span className="sidebar__count">{stats ? stats.pending[key.toLowerCase() as 'urgent' | 'normal' | 'low'] : '–'}</span>
        </button>
      ))}
      <button
        className={`sidebar__item ${priorityFilter === undefined ? 'sidebar__item--active' : ''}`}
        onClick={() => onPriorityChange(undefined)}
      >
        <span className="sidebar__item-label">All</span>
        <span className="sidebar__count">{totalPending(stats)}</span>
      </button>

      <div className="sidebar__section-label">Date</div>
      <div className="sidebar__date-range">
        <label className="sidebar__date-field">
          <span>From</span>
          <input
            type="date"
            value={dateFrom ?? ''}
            onChange={(e) => onDateFromChange(e.target.value || undefined)}
          />
        </label>
        <label className="sidebar__date-field">
          <span>To</span>
          <input
            type="date"
            value={dateTo ?? ''}
            onChange={(e) => onDateToChange(e.target.value || undefined)}
          />
        </label>
        {(dateFrom || dateTo) && (
          <button
            className="sidebar__date-clear"
            onClick={() => {
              onDateFromChange(undefined);
              onDateToChange(undefined);
            }}
          >
            ล้างช่วงวันที่
          </button>
        )}
      </div>

      <div className="sidebar__section-label">Category</div>
      {CATEGORIES.map((category) => (
        <button
          key={category}
          className={`sidebar__item ${categoryFilter === category ? 'sidebar__item--active' : ''}`}
          onClick={() => onCategoryChange(categoryFilter === category ? undefined : category)}
        >
          <span className="sidebar__item-label">{category}</span>
        </button>
      ))}

      <div className="sidebar__spacer" />

      <div className="sidebar__footer">
        <div className="sidebar__user-email" title={userEmail}>
          {userEmail}
        </div>
        <button className="sidebar__logout" onClick={onLogout}>
          Logout
        </button>
      </div>
    </nav>
  );
}
