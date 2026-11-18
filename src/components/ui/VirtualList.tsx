import { useRef, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '@/lib/utils';

/** Windowed list — keeps DOM light for History / long tables. */
export function VirtualList<T>({
  items,
  estimateSize,
  overscan = 8,
  className,
  height = 560,
  getKey,
  renderRow,
}: {
  items: T[];
  estimateSize: (index: number) => number;
  overscan?: number;
  className?: string;
  height?: number | string;
  getKey: (item: T, index: number) => string;
  renderRow: (item: T, index: number) => ReactNode;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize,
    overscan,
  });

  return (
    <div
      ref={parentRef}
      className={cn('overflow-auto outline-none', className)}
      style={{ height }}
    >
      <div
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((vRow) => {
          const item = items[vRow.index];
          return (
            <div
              key={getKey(item, vRow.index)}
              data-index={vRow.index}
              ref={virtualizer.measureElement}
              className="absolute left-0 top-0 w-full"
              style={{ transform: `translateY(${vRow.start}px)` }}
            >
              {renderRow(item, vRow.index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
