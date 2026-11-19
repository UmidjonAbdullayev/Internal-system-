import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

export function TripLegend({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Progress & status legend" size="md"
      footer={<Button onClick={onClose}>Close</Button>}
    >
      <div className="space-y-5 text-sm">
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
            Progress bar
          </h3>
          <ul className="space-y-2">
            <li className="flex items-center gap-2">
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-success bg-success px-1 text-[9px] font-mono text-white">
                A1
              </span>
              <span>Done — filled green</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-info bg-info px-1 text-[9px] font-mono text-white ring-2 ring-info/40 ring-offset-1">
                B2
              </span>
              <span>At stop — solid blue with ring</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-slate-300 bg-card px-1 text-[9px] font-mono text-text-secondary">
                C3
              </span>
              <span>Not reached — outlined grey</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-danger bg-card px-1 text-[9px] font-mono text-danger">
                D4
              </span>
              <span>Late (any state) — red outline</span>
            </li>
            <li className="text-text-secondary text-xs">
              Solid connector = completed segment · Dashed = toward next stop
            </li>
          </ul>
        </section>
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
            Stops inside an opened trip
          </h3>
          <ul className="space-y-2">
            {[
              ['border-success bg-success text-white', 'border-emerald-200 bg-emerald-50 text-emerald-700', 'Done', 'Arrived and departed'],
              ['border-info bg-info text-white ring-2 ring-info/40 ring-offset-1', 'border-blue-300 bg-blue-50 text-blue-700', 'At stop', 'Driver is there now'],
              ['border-2 border-info bg-card text-info', 'border-blue-200 bg-white text-blue-700', 'Next', 'Heading here, still on time'],
              ['border-2 border-danger bg-danger-bg text-danger', 'border-red-200 bg-red-50 text-red-700', 'Late', 'Should be there by now (15+ min), not arrived'],
              ['border-slate-300 bg-card text-text-secondary', 'border-border bg-bg text-text-secondary', 'Upcoming', 'Later stop'],
              ['border-dashed border-slate-300 bg-slate-50 text-slate-400', 'border-slate-200 bg-slate-50 text-slate-400 line-through', 'Cancelled', 'Stop on a cancelled leg'],
            ].map(([circle, badge, word, meaning]) => (
              <li key={word} className="flex items-center gap-2">
                <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full border text-[9px] font-semibold ${circle}`}>
                  1
                </span>
                <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${badge}`}>
                  Pickup
                </span>
                <span className="font-medium">{word}</span>
                <span className="text-text-secondary">{meaning}</span>
              </li>
            ))}
            <li className="text-xs text-text-secondary">
              Actual arrival time: blue = early, green = on time, red = late (±15 min, same rule as Telegram).
            </li>
          </ul>
        </section>
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
            Timing chips
          </h3>
          <ul className="space-y-2">
            <li>
              <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                On time
              </span>
              <span className="ml-2 text-text-secondary">On schedule</span>
            </li>
            <li>
              <span className="rounded-md border border-orange-200 bg-orange-50 px-2 py-0.5 text-xs text-orange-800">
                Late
              </span>
              <span className="ml-2 text-text-secondary">Late with a reported reason</span>
            </li>
            <li>
              <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-800">
                Running late
              </span>
              <span className="ml-2 text-text-secondary">Past schedule, not yet arrived</span>
            </li>
            <li>
              <span className="rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-xs text-red-700">
                Late – no reason
              </span>
              <span className="ml-2 text-text-secondary">Late with no delay reason in Relay</span>
            </li>
          </ul>
        </section>
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
            Needs attention
          </h3>
          <p className="text-text-secondary text-xs leading-relaxed">
            Late with no reason, running late, missing driver, or missing tractor.
          </p>
        </section>
      </div>
    </Modal>
  );
}
