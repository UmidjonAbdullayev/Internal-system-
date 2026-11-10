import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  Plus,
  Search,
  Calendar,
  ChevronDown,
} from 'lucide-react';
import { format } from 'date-fns';
import { useData } from '@/context/DataContext';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { QuickAddModal } from '@/components/shared/QuickAddModal';

export function TopNav() {
  const { currentUser, companySettings, activityLogs } = useData();
  const [search, setSearch] = useState('');
  const [showNotifs, setShowNotifs] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const navigate = useNavigate();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!search.trim()) return;
    navigate(`/loads?q=${encodeURIComponent(search.trim())}`);
  };

  return (
    <>
      <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-border bg-white/90 px-4 backdrop-blur-md sm:px-6 no-print">
        <form onSubmit={handleSearch} className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search loads, drivers, trailers..."
            className="h-9 w-full rounded-lg border border-border bg-bg pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-secondary/30 focus:border-secondary focus:bg-white transition-colors"
          />
        </form>

        <div className="hidden md:flex items-center gap-2 rounded-lg border border-border bg-bg px-3 py-1.5 text-xs text-text-secondary">
          <Calendar className="h-3.5 w-3.5" />
          <span>{format(new Date('2026-11-10'), 'EEE, MMM d, yyyy')}</span>
        </div>

        <Button size="sm" onClick={() => setShowQuickAdd(true)} className="shrink-0">
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Quick Add</span>
        </Button>

        <div className="relative">
          <button
            type="button"
            onClick={() => setShowNotifs(!showNotifs)}
            className="relative rounded-lg p-2 text-text-secondary hover:bg-bg hover:text-text transition-colors"
          >
            <Bell className="h-5 w-5" />
            <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-danger ring-2 ring-white" />
          </button>
          {showNotifs && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowNotifs(false)} />
              <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-xl border border-border bg-white shadow-xl animate-slide-down">
                <div className="border-b border-border px-4 py-3">
                  <p className="text-sm font-semibold text-text">Notifications</p>
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {activityLogs.slice(0, 6).map((a) => (
                    <div
                      key={a.id}
                      className="border-b border-border/60 px-4 py-3 hover:bg-bg transition-colors"
                    >
                      <p className="text-xs text-text leading-relaxed">{a.description}</p>
                      <p className="mt-1 text-[10px] text-text-secondary">
                        {format(new Date(a.timestamp), 'MMM d, h:mm a')}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-2.5 pl-2 border-l border-border">
          <div className="hidden lg:block text-right">
            <p className="text-sm font-medium text-text leading-tight">{currentUser.name}</p>
            <p className="text-[10px] text-text-secondary">{companySettings.companyName}</p>
          </div>
          <div
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-full bg-primary text-xs font-bold text-white'
            )}
          >
            {currentUser.name
              .split(' ')
              .map((n) => n[0])
              .join('')}
          </div>
          <ChevronDown className="hidden sm:block h-3.5 w-3.5 text-text-secondary" />
        </div>
      </header>

      <QuickAddModal open={showQuickAdd} onClose={() => setShowQuickAdd(false)} />
    </>
  );
}
