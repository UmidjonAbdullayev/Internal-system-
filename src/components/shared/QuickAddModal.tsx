import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Package, Users, Receipt, Wallet } from 'lucide-react';

export function QuickAddModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<string | null>(null);

  const options = [
    { key: 'load', label: 'New Load', desc: 'Add an Amazon Relay or manual load', icon: Package, path: '/loads?action=new' },
    { key: 'driver', label: 'New Driver', desc: 'Register a new company driver', icon: Users, path: '/drivers?action=new' },
    { key: 'charge', label: 'One-Time Charge', desc: 'Add a charge to a settlement', icon: Receipt, path: '/settlements?action=charge' },
    { key: 'payment', label: 'Record Payment', desc: 'Mark a settlement as paid', icon: Wallet, path: '/payments' },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Quick Add"
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!selected}
            onClick={() => {
              const opt = options.find((o) => o.key === selected);
              if (opt) {
                onClose();
                navigate(opt.path);
              }
            }}
          >
            Continue
          </Button>
        </>
      }
    >
      <div className="grid gap-2">
        {options.map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => setSelected(opt.key)}
            className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-all ${
              selected === opt.key
                ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                : 'border-border hover:bg-bg'
            }`}
          >
            <div className="rounded-lg bg-primary/10 p-2.5 text-primary">
              <opt.icon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-text">{opt.label}</p>
              <p className="text-xs text-text-secondary">{opt.desc}</p>
            </div>
          </button>
        ))}
      </div>
    </Modal>
  );
}
