import { useEffect, useState } from 'react';
import { useNavigation } from 'react-router-dom';
import { cn } from '@/lib/utils';

/** Top progress bar for route transitions + optional fetching flag. */
export function NavigationProgress({ fetching = false }: { fetching?: boolean }) {
  const navigation = useNavigation();
  const navigating = navigation.state !== 'idle';
  const active = navigating || fetching;
  const [visible, setVisible] = useState(false);

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
