import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useVirtualizer, useWindowVirtualizer } from '@tanstack/react-virtual';
import { cn } from '@/lib/utils';

type VirtualListProps<T> = {
  items: T[];
  estimateSize: (index: number) => number;
  overscan?: number;
  className?: string;
  height?: number | string;
  getKey: (item: T, index: number) => string;
  renderRow: (item: T, index: number) => ReactNode;
  /**
   * Scroll with the page instead of an inner box (no double scrollbar).
   * Needed for sticky rows: sticky only works against the page scroll here.
   */
  windowScroll?: boolean;
};

/** Windowed list — keeps DOM light for History / long tables. */
export function VirtualList<T>(props: VirtualListProps<T>) {
  return props.windowScroll ? <WindowVirtualList {...props} /> : <BoxVirtualList {...props} />;
}

function Rows<T>({
  items,
  rows,
  totalSize,
  offset,
  measure,
  getKey,
  renderRow,
}: {
  items: T[];
  rows: Array<{ index: number; start: number }>;
  totalSize: number;
  offset: number;
  measure: (el: Element | null) => void;
  getKey: (item: T, index: number) => string;
  renderRow: (item: T, index: number) => ReactNode;
}) {
  return (
    <div className="relative w-full" style={{ height: totalSize }}>
      {rows.map((vRow) => {
        const item = items[vRow.index];
        return (
          <div
            key={getKey(item, vRow.index)}
            data-index={vRow.index}
            ref={measure}
            className="absolute left-0 top-0 w-full"
            style={{ transform: `translateY(${vRow.start - offset}px)` }}
          >
            {renderRow(item, vRow.index)}
          </div>
        );
      })}
    </div>
  );
}

function BoxVirtualList<T>({
  items,
  estimateSize,
  overscan = 8,
  className,
  height = 560,
  getKey,
  renderRow,
}: VirtualListProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize,
    overscan,
  });

  return (
    <div ref={parentRef} className={cn('overflow-auto outline-none', className)} style={{ height }}>
      <Rows
        items={items}
        rows={virtualizer.getVirtualItems()}
        totalSize={virtualizer.getTotalSize()}
        offset={0}
        measure={virtualizer.measureElement}
        getKey={getKey}
        renderRow={renderRow}
      />
    </div>
  );
}

function WindowVirtualList<T>({
  items,
  estimateSize,
  overscan = 8,
  className,
  getKey,
  renderRow,
}: VirtualListProps<T>) {
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  // Distance from the top of the page to the list (filters above it can change height).
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const update = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      setScrollMargin((prev) => (Math.abs(prev - top) > 1 ? top : prev));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(document.body);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  const virtualizer = useWindowVirtualizer({
    count: items.length,
    estimateSize,
    overscan,
    scrollMargin,
  });

  return (
    <div ref={listRef} className={cn('outline-none', className)}>
      <Rows
        items={items}
        rows={virtualizer.getVirtualItems()}
        totalSize={virtualizer.getTotalSize()}
        offset={virtualizer.options.scrollMargin}
        measure={virtualizer.measureElement}
        getKey={getKey}
        renderRow={renderRow}
      />
    </div>
  );
}
