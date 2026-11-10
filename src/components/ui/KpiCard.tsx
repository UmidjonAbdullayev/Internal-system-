import { cn, formatCurrency, formatNumber } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

interface KpiCardProps {
  title: string;
  value: number;
  format?: 'currency' | 'number';
  icon?: LucideIcon;
  trend?: number;
  accent?: 'primary' | 'success' | 'warning' | 'danger' | 'info';
  subtitle?: string;
  className?: string;
  highlight?: boolean;
}

const accents = {
  primary: 'bg-primary/10 text-primary',
  success: 'bg-success-bg text-success',
  warning: 'bg-warning-bg text-warning',
  danger: 'bg-danger-bg text-danger',
  info: 'bg-info-bg text-info',
};

export function KpiCard({
  title,
  value,
  format = 'currency',
  icon: Icon,
  trend,
  accent = 'primary',
  subtitle,
  className,
  highlight,
}: KpiCardProps) {
  return (
    <div
      className={cn(
        'rounded-xl border bg-card p-4 shadow-sm transition-all duration-200 hover:shadow-md',
        highlight ? 'border-primary/30 ring-1 ring-primary/10' : 'border-border',
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-text-secondary">
            {title}
          </p>
          <p className="mt-1.5 font-display text-xl font-bold text-text tabular-nums truncate">
            {format === 'currency' ? formatCurrency(value) : formatNumber(value)}
          </p>
          {subtitle && (
            <p className="mt-1 text-xs text-text-secondary">{subtitle}</p>
          )}
          {trend !== undefined && (
            <p
              className={cn(
                'mt-1 text-xs font-medium',
                trend >= 0 ? 'text-success' : 'text-danger'
              )}
            >
              {trend >= 0 ? '↑' : '↓'} {Math.abs(trend).toFixed(1)}% vs prior
            </p>
          )}
        </div>
        {Icon && (
          <div className={cn('rounded-lg p-2.5 shrink-0', accents[accent])}>
            <Icon className="h-4 w-4" />
          </div>
        )}
      </div>
    </div>
  );
}
