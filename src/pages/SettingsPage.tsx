import { useState } from 'react';
import { useData } from '@/context/DataContext';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Field, Select } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';

export function SettingsPage() {
  const { companySettings, updateSettings, currentUser, drivers, loads, settlements } = useData();
  const [form, setForm] = useState({ ...companySettings });

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Company configuration and system preferences"
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Company Profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Field label="Company Name">
              <Input
                value={form.companyName}
                onChange={(e) => setForm({ ...form, companyName: e.target.value })}
              />
            </Field>
            <Field label="Address">
              <Input
                value={form.companyAddress}
                onChange={(e) => setForm({ ...form, companyAddress: e.target.value })}
              />
            </Field>
            <Field label="EIN">
              <Input value={form.ein} onChange={(e) => setForm({ ...form, ein: e.target.value })} />
            </Field>
            <Field label="Timezone">
              <Select
                value={form.timezone}
                onChange={(e) => setForm({ ...form, timezone: e.target.value })}
              >
                <option value="America/Chicago">America/Chicago (CT)</option>
                <option value="America/New_York">America/New_York (ET)</option>
                <option value="America/Denver">America/Denver (MT)</option>
                <option value="America/Los_Angeles">America/Los_Angeles (PT)</option>
              </Select>
            </Field>
            <Field label="Week Starts On">
              <Select
                value={String(form.weekStartsOn)}
                onChange={(e) =>
                  setForm({ ...form, weekStartsOn: Number(e.target.value) as 0 | 1 })
                }
              >
                <option value="1">Monday</option>
                <option value="0">Sunday</option>
              </Select>
            </Field>
            <Field label="Default Dispatch Fee %">
              <Input
                type="number"
                value={form.defaultDispatchFeePercent}
                onChange={(e) =>
                  setForm({ ...form, defaultDispatchFeePercent: Number(e.target.value) })
                }
              />
            </Field>
            <Button onClick={() => updateSettings(form)}>Save Settings</Button>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Current User</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-white font-bold">
                  {currentUser.name.split(' ').map((n) => n[0]).join('')}
                </div>
                <div>
                  <p className="font-semibold">{currentUser.name}</p>
                  <p className="text-text-secondary">{currentUser.email}</p>
                </div>
              </div>
              <div className="pt-2">
                <Badge status={currentUser.role} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>System Snapshot</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-lg bg-bg p-3">
                <p className="text-2xl font-bold font-display text-primary">{drivers.length}</p>
                <p className="text-xs text-text-secondary">Drivers</p>
              </div>
              <div className="rounded-lg bg-bg p-3">
                <p className="text-2xl font-bold font-display text-primary">{loads.length}</p>
                <p className="text-xs text-text-secondary">Loads</p>
              </div>
              <div className="rounded-lg bg-bg p-3">
                <p className="text-2xl font-bold font-display text-primary">{settlements.length}</p>
                <p className="text-xs text-text-secondary">Settlements</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Data Layer</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-text-secondary space-y-2">
              <p>
                Currently running on in-memory mock data with a separated data context.
                Ready to connect to Supabase — see <code className="text-xs bg-bg px-1 rounded">supabase/schema.sql</code>.
              </p>
              <p>
                Financial totals are always derived from underlying load, fee, and charge records —
                never hardcoded in the UI.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
