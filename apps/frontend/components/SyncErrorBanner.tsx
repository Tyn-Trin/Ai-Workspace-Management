import type { SyncError } from '../types';
import { apiClient } from '../lib/api-client';

export function SyncErrorBanner({ error }: { error: SyncError | null }) {
  if (!error) return null;

  return (
    <div className="sync-error-banner">
      <span>เชื่อมต่อ Gmail มีปัญหา: {error.message}</span>
      <a href={apiClient.loginUrl()}>Login ใหม่</a>
    </div>
  );
}
