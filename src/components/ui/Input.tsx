import { cn } from '@/lib/utils';
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-9 w-full rounded-lg border border-border bg-white px-3 text-sm text-text',
        'placeholder:text-text-secondary/70',
        'focus:outline-none focus:ring-2 focus:ring-secondary/30 focus:border-secondary',
        'disabled:bg-bg disabled:cursor-not-allowed',
        className
      )}
      {...props}
    />
  );
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'h-9 w-full rounded-lg border border-border bg-white px-3 text-sm text-text',
        'focus:outline-none focus:ring-2 focus:ring-secondary/30 focus:border-secondary',
        className
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text',
        'placeholder:text-text-secondary/70',
        'focus:outline-none focus:ring-2 focus:ring-secondary/30 focus:border-secondary',
        'min-h-[80px] resize-y',
        className
      )}
      {...props}
    />
  );
}

export function Label({
  children,
  htmlFor,
  className,
}: {
  children: React.ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn('mb-1.5 block text-xs font-medium text-text-secondary', className)}
    >
      {children}
    </label>
  );
}

export function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col', className)}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}
