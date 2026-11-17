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
