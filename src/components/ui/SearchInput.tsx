import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search...',
  className,
  /** Debounce outbound onChange (default 300ms). Set 0 for immediate. */
  debounceMs = 300,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  debounceMs?: number;
}) {
  const [local, setLocal] = useState(value);

  useEffect(() => {
    setLocal(value);
  }, [value]);

  useEffect(() => {
    if (debounceMs <= 0) {
      onChange(local);
      return;
    }
    const t = window.setTimeout(() => {
      if (local !== value) onChange(local);
    }, debounceMs);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: debounce local only
  }, [local, debounceMs]);

  return (
    <div className={cn('relative', className)}>
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary" />
      <input
        value={local}
        onChange={(e) => {
          const next = e.target.value;
          setLocal(next);
          if (debounceMs <= 0) onChange(next);
        }}
        placeholder={placeholder}
        className="h-9 w-full rounded-lg border border-border bg-white pl-9 pr-8 text-sm text-text placeholder:text-text-secondary/70 focus:outline-none focus:ring-2 focus:ring-secondary/30 focus:border-secondary"
      />
      {local && (
        <button
          type="button"
          onClick={() => {
            setLocal('');
            onChange('');
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-text-secondary hover:text-text"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
