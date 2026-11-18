import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { DataProvider } from '@/context/DataContext';
import { queryClient } from '@/lib/queryClient';
import { AppLayout } from '@/components/layout/AppLayout';
import { OverviewPage } from '@/pages/OverviewPage';
import { LoadsPage } from '@/pages/LoadsPage';
import { GrossBoardPage } from '@/pages/GrossBoardPage';
import { GrossByDriverPage } from '@/pages/GrossByDriverPage';
import { PaymentsPage } from '@/pages/PaymentsPage';
import { SettlementDetailPage } from '@/pages/SettlementDetailPage';
import { DriversPage } from '@/pages/DriversPage';
import { DriverDetailPage } from '@/pages/DriverDetailPage';
import { SettlementsChargesPage } from '@/pages/SettlementsChargesPage';
import { ReportsPage } from '@/pages/ReportsPage';
import { DataChecksPage } from '@/pages/DataChecksPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { AlertPreviewPage } from '@/pages/AlertPreviewPage';

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <DataProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<AppLayout />}>
              <Route index element={<OverviewPage />} />
              <Route path="loads" element={<LoadsPage />} />
              <Route path="drivers" element={<DriversPage />} />
              <Route path="drivers/:id" element={<DriverDetailPage />} />
              <Route path="gross-board" element={<GrossBoardPage />} />
              <Route path="gross-by-driver" element={<GrossByDriverPage />} />
              <Route path="payments" element={<PaymentsPage />} />
              <Route path="payments/:id" element={<SettlementDetailPage />} />
              <Route path="settlements" element={<SettlementsChargesPage />} />
              <Route path="reports" element={<ReportsPage />} />
              <Route path="data-checks" element={<DataChecksPage />} />
              <Route path="alert-preview" element={<AlertPreviewPage />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
        <Toaster position="top-right" richColors closeButton />
      </DataProvider>
    </QueryClientProvider>
  );
}
