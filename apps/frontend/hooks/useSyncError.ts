'use client';

import { useEffect, useState } from 'react';
import { getSocket } from '../lib/ws-client';
import type { SyncError } from '../types';

export function useSyncError() {
  const [error, setError] = useState<SyncError | null>(null);

  useEffect(() => {
    const socket = getSocket();
    const handle = (payload: SyncError) => setError(payload);
    socket.on('sync:error', handle);
    return () => {
      socket.off('sync:error', handle);
    };
  }, []);

  return error;
}
