import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useIsFetching, useIsMutating } from '@tanstack/react-query';
import { cn } from '@/lib/utils';

/**
 * Top progress bar for BrowserRouter route changes + TanStack Query activity.
 * Must NOT use data-router hooks (useNavigation / useFetcher / etc.) —
 * this app uses <BrowserRouter>, not createBrowserRouter.
 */
export function NavigationProgress({ fetching = false }: { fetching?: boolean }) {
  const location = useLocation();
  const isFetching = useIsFetching();
  const isMutating = useIsMutating();
  const [routePending, setRoutePending] = useState(false);
  const prevKey = useRef(location.key);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (prevKey.current === location.key) return;
    prevKey.current = location.key;
    setRoutePending(true);
    const t = window.setTimeout(() => setRoutePending(false), 280);
    return () => window.clearTimeout(t);
  }, [location.key]);

  const active = routePending || fetching || isFetching > 0 || isMutating > 0;

  useEffect(() => {
    if (active) {
      setVisible(true);
      return;
    }
    const t = window.setTimeout(() => setVisible(false), 220);
    return () => window.clearTimeout(t);
  }, [active]);

  if (!visible) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5 overflow-hidden bg-transparent"
      aria-hidden
    >
      <div
        className={cn(
          'h-full w-1/3 bg-secondary transition-transform duration-300',
          active ? 'animate-nav-progress' : 'translate-x-[300%]',
        )}
      />
    </div>
  );
}
