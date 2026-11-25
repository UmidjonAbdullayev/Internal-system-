import { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { SERVICE_PAUSED, SERVICE_PAUSED_MESSAGE } from '@/lib/serviceStatus';

export function ServicePausedBanner() {
  const [hidden, setHidden] = useState(false);
  if (!SERVICE_PAUSED || hidden) return null;
  return (
    <div className="fixed inset-x-0 top-3 z-[100] flex justify-center px-3 pointer-events-none">
      <div
        role="alert"
        className="pointer-events-auto flex max-w-2xl items-start gap-3 rounded-lg border border-red-500/40 bg-red-950/95 px-4 py-3 text-sm text-red-100 shadow-lg backdrop-blur"
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
        <span className="leading-snug">{SERVICE_PAUSED_MESSAGE}</span>
        <button
          type="button"
          onClick={() => setHidden(true)}
          className="ml-1 rounded p-0.5 text-red-300 hover:bg-red-900 hover:text-red-100"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
