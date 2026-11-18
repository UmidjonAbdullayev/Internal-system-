import { useCallback, useEffect, useState } from 'react';
import { useData } from '@/context/DataContext';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Field, Select } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { supabase } from '@/lib/supabase';

type BotUser = {
  id: string;
  telegram_user_id: number;
  display_name: string | null;
  role: string;
  authorized_at: string;
  last_active_at: string;
  revoked_at: string | null;
};

export function SettingsPage() {
  const { companySettings, updateSettings, currentUser, drivers, loads, settlements } = useData();
  const [form, setForm] = useState({ ...companySettings });
  const [botPassword, setBotPassword] = useState('');
  const [botMsg, setBotMsg] = useState<string | null>(null);
  const [botUsers, setBotUsers] = useState<BotUser[]>([]);
  const [passwordSet, setPasswordSet] = useState(false);

  const loadBot = useCallback(async () => {
    const [{ data: cfg }, { data: users }] = await Promise.all([
      supabase.from('telegram_bot_config').select('password_hash, password_updated_at').eq('id', 1).maybeSingle(),
      supabase
        .from('bot_users')
        .select('id, telegram_user_id, display_name, role, authorized_at, last_active_at, revoked_at')
        .order('last_active_at', { ascending: false })
        .limit(50),
    ]);
    setPasswordSet(Boolean(cfg?.password_hash));
    setBotUsers((users as BotUser[]) || []);
  }, []);

  useEffect(() => {
    void loadBot();
  }, [loadBot]);

  const saveBotPassword = async () => {
    setBotMsg(null);
    const { data, error } = await supabase.rpc('set_telegram_bot_password', {
      p_password: botPassword,
    });
    if (error) {
      setBotMsg(error.message);
      return;
    }
    if (data && typeof data === 'object' && 'ok' in data && !(data as { ok: boolean }).ok) {
      setBotMsg(String((data as { error?: string }).error || 'Failed'));
      return;
    }
    setBotPassword('');
    setBotMsg('Password updated (bcrypt hash stored). Existing sessions stay until “Log out everyone”.');
    await loadBot();
  };

  const logoutEveryone = async () => {
    setBotMsg(null);
    const { error } = await supabase.rpc('telegram_bot_logout_everyone');
    if (error) {
      setBotMsg(error.message);
      return;
    }
    setBotMsg('All bot users revoked.');
    await loadBot();
  };

  const revokeUser = async (id: string) => {
    await supabase
      .from('bot_users')
      .update({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', id);
    await loadBot();
  };

  const setRole = async (id: string, role: 'viewer' | 'admin') => {
    await supabase.from('bot_users').update({ role, updated_at: new Date().toISOString() }).eq('id', id);
    await loadBot();
  };

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Company configuration and Telegram bot access"
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
                <option value="Asia/Tashkent">Asia/Tashkent (UZT)</option>
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
            <Field label="History retention (days)">
              <Input
                type="number"
                min={1}
                value={form.historyRetentionDays ?? 45}
                onChange={(e) =>
                  setForm({
                    ...form,
                    historyRetentionDays: Math.max(1, Number(e.target.value) || 45),
                  })
                }
              />
            </Field>
            <p className="text-xs text-text-secondary">
              Daily 03:00 cleanup copies HISTORY trips older than this into permanent trip_summaries,
              then deletes detail (never Upcoming / In Transit).
            </p>
            <Button onClick={() => updateSettings(form)}>Save Settings</Button>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Telegram bot password</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="text-text-secondary">
                Private DM unlock for @inter_sysbot. Stored as bcrypt only.
                {passwordSet ? ' Password is set.' : ' No password set yet.'}
              </p>
              <Field label="New password">
                <Input
                  type="password"
                  value={botPassword}
                  onChange={(e) => setBotPassword(e.target.value)}
                  placeholder="Min 6 characters"
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void saveBotPassword()} disabled={botPassword.length < 6}>
                  Save password
                </Button>
                <Button variant="danger" onClick={() => void logoutEveryone()}>
                  Log out everyone
                </Button>
              </div>
              {botMsg && <p className="text-xs text-text-secondary">{botMsg}</p>}
              <p className="text-xs text-text-secondary">
                Alerts stay OFF until TELEGRAM_ALERTS_ENABLED is approved. See Alert preview.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Bot users</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {botUsers.length === 0 && (
                <p className="text-text-secondary">No authorized Telegram users yet.</p>
              )}
              {botUsers.map((u) => (
                <div
                  key={u.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-bg px-3 py-2"
                >
                  <span className="font-mono text-xs">{u.telegram_user_id}</span>
                  <Badge status={u.revoked_at ? 'revoked' : u.role} />
                  <span className="text-xs text-text-secondary">
                    last {new Date(u.last_active_at).toLocaleString()}
                  </span>
                  <div className="ml-auto flex gap-1">
                    {!u.revoked_at && (
                      <>
                        <Button
                          variant="ghost"
                          onClick={() => void setRole(u.id, u.role === 'admin' ? 'viewer' : 'admin')}
                        >
                          {u.role === 'admin' ? 'Make viewer' : 'Make admin'}
                        </Button>
                        <Button variant="danger" onClick={() => void revokeUser(u.id)}>
                          Revoke
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

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
        </div>
      </div>
    </div>
  );
}
