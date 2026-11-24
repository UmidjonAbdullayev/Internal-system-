import type { RowStage } from '@/lib/reportLoadMoney';

export const STAGE_LABEL: Record<RowStage, string> = {
  invoiced: 'Invoiced',
  awaiting_invoice: 'Done · awaiting invoice',
  in_progress: 'In progress',
  cancelled: 'Cancelled',
};

export const STAGE_CLASS: Record<RowStage, string> = {
  invoiced: 'bg-success-bg text-success',
  awaiting_invoice: 'bg-info-bg text-info',
  in_progress: 'bg-warning-bg text-warning',
  cancelled: 'bg-bg text-text-secondary',
};
