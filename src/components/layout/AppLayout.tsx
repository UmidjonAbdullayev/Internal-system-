import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopNav } from './TopNav';
import { NavigationProgress } from '@/components/ui/NavigationProgress';
import { useData } from '@/context/DataContext';
import { cn } from '@/lib/utils';

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const { dataFetching } = useData();

  return (
    <div className="min-h-full bg-bg">
      <NavigationProgress fetching={dataFetching} />
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      <div
        className={cn(
          'min-h-full transition-all duration-300',
          collapsed ? 'ml-[72px]' : 'ml-60'
        )}
      >
        <TopNav />
        <main className="p-4 sm:p-6 animate-fade-in">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
