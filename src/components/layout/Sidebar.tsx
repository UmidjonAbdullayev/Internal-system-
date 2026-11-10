import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Package,
  Users,
  TrendingUp,
  UserRound,
  Wallet,
  Receipt,
  BarChart3,
  Settings,
  Truck,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useData } from '@/context/DataContext';

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/loads', label: 'Loads', icon: Package },
  { to: '/drivers', label: 'Drivers', icon: Users },
  { to: '/gross-board', label: 'Gross Board', icon: TrendingUp, highlight: true },
  { to: '/gross-by-driver', label: 'Gross by Driver', icon: UserRound, highlight: true },
  { to: '/payments', label: 'Payments / Paycheck', icon: Wallet, highlight: true },
  { to: '/settlements', label: 'Settlements & Charges', icon: Receipt },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { companySettings } = useData();

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 z-40 flex h-full flex-col border-r border-primary-dark/20 bg-primary text-white transition-all duration-300 no-print',
        collapsed ? 'w-[72px]' : 'w-60'
      )}
    >
      <div className="flex h-16 items-center gap-3 border-b border-white/10 px-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/15">
          <Truck className="h-5 w-5" />
        </div>
        {!collapsed && (
          <div className="min-w-0 animate-fade-in">
            <p className="font-display text-sm font-bold truncate">Internal Sys</p>
            <p className="text-[10px] text-white/60 truncate">
              {companySettings.companyName}
            </p>
          </div>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-4 space-y-0.5">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150',
                isActive
                  ? 'bg-white text-primary shadow-sm'
                  : 'text-white/80 hover:bg-white/10 hover:text-white',
                item.highlight && !isActive && 'text-white font-semibold'
              )
            }
            title={collapsed ? item.label : undefined}
          >
            <item.icon className="h-4.5 w-4.5 shrink-0 h-[18px] w-[18px]" />
            {!collapsed && (
              <span className="truncate flex items-center gap-2">
                {item.label}
                {item.highlight && (
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-300" />
                )}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      <button
        type="button"
        onClick={onToggle}
        className="m-2 flex items-center justify-center rounded-lg border border-white/10 py-2 text-white/70 hover:bg-white/10 hover:text-white transition-colors"
      >
        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
      </button>
    </aside>
  );
}
