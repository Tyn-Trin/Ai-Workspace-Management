'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../lib/api-client';
import { getSocket } from '../lib/ws-client';
import type { Stats } from '../types';

export function useStats() {
  const [stats, setStats] = useState<Stats | null>(null);

  const reload = useCallback(() => {
    apiClient.getStats().then(setStats).catch(() => {});
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    const socket = getSocket();
    // ai service ส่ง stats:updated ตามหลัง email:classified/status_changed เสมอ (PLAN-V2.md §6.3)
    const handleUpdated = () => reload();
    socket.on('stats:updated', handleUpdated);
    return () => {
      socket.off('stats:updated', handleUpdated);
    };
  }, [reload]);

  return stats;
}
