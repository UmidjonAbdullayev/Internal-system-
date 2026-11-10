import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SortDir = 'asc' | 'desc';

export function SortHeader({
  label,
  sortKey,
  currentKey,
  direction,
  onSort,
  className,
  align = 'left',
}: {
  label: string;
  sortKey: string;
  currentKey: string;
  direction: SortDir;
  onSort: (key: string) => void;
  className?: string;
  align?: 'left' | 'right';
}) {
  const active = currentKey === sortKey;
  return (
    <th
      className={cn(
        'px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-text-secondary whitespace-nowrap cursor-pointer select-none hover:text-text',
        align === 'right' ? 'text-right' : 'text-left',
        className
      )}
      onClick={() => onSort(sortKey)}
    >
      <span className={cn('inline-flex items-center gap-1', align === 'right' && 'flex-row-reverse')}>
        {label}
        {active ? (
          direction === 'asc' ? (
            <ArrowUp className="h-3 w-3 text-primary" />
          ) : (
            <ArrowDown className="h-3 w-3 text-primary" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-40" />
        )}
      </span>
    </th>
  );
}

export function useSort<T>(
  items: T[],
  key: string,
  direction: SortDir,
  getters: Record<string, (item: T) => string | number>
): T[] {
  if (!key || !getters[key]) return items;
  const getter = getters[key];
  return [...items].sort((a, b) => {
    const av = getter(a);
    const bv = getter(b);
    if (typeof av === 'number' && typeof bv === 'number') {
      return direction === 'asc' ? av - bv : bv - av;
    }
    const cmp = String(av).localeCompare(String(bv));
    return direction === 'asc' ? cmp : -cmp;
  });
}
