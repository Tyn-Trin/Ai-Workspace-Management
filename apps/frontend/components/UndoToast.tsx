'use client';

import { useEffect } from 'react';

const AUTO_DISMISS_MS = 5000;

export function UndoToast({
  message,
  onUndo,
  onDismiss,
}: {
  message: string;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div className="undo-toast">
      <span>{message}</span>
      <button
        className="undo-toast__button"
        onClick={() => {
          onUndo();
          onDismiss();
        }}
      >
        Undo
      </button>
    </div>
  );
}
