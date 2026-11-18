import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

export const crmKeys = {
  shell: ['crm', 'shell'] as const,
  reportLoads: (range?: string) => ['crm', 'reportLoads', range ?? 'all'] as const,
  liveTrips: ['crm', 'trips', 'live'] as const,
  historyTrips: (from: string, to: string) => ['crm', 'trips', 'history', from, to] as const,
  tripCounts: ['crm', 'tripCounts'] as const,
  loads: ['crm', 'loads'] as const,
  invoices: ['crm', 'invoices'] as const,
};
