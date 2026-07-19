'use client';

/**
 * @file app/(dashboard)/dashboard/calendar/page.tsx
 * @description Execution calendar — unified view of campaigns, experiments, briefs, and authored events.
 *   Milestone 09 — full calendar UI replacing the Phase 9 stub.
 * @security Auth token from Supabase session; all API calls authenticated.
 * @dependencies api.calendar, Supabase Auth
 */

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageShell } from '@/components/launchmind/PageShell';
import {
  IconCalendar,
  IconPlus,
  IconChevronLeft,
  IconChevronRight,
  IconList,
  IconLoader,
  IconSpeakerphone,
  IconFlask,
  IconFileAnalytics,
  IconStar,
  IconTrash,
} from '@tabler/icons-react';
import { api } from '@/lib/api';
import type { CalendarEvent, CalendarEventType } from '@/lib/api';

// ── Helpers ───────────────────────────────────────────────────────────────────

const TYPE_META: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  campaign_launch:    { color: '#059669', icon: <IconSpeakerphone size={12} />, label: 'Campaign' },
  experiment_window:  { color: '#4f46e5', icon: <IconFlask size={12} />, label: 'Experiment' },
  content_publish:    { color: '#059669', icon: <IconStar size={12} />, label: 'Content' },
  aso_update:         { color: '#d97706', icon: <IconStar size={12} />, label: 'ASO' },
  review_push:        { color: '#4f46e5', icon: <IconStar size={12} />, label: 'Reviews' },
  brief_sent:         { color: '#626880', icon: <IconFileAnalytics size={12} />, label: 'Brief' },
  product_launch:     { color: '#dc2626', icon: <IconStar size={12} />, label: 'Launch' },
  holiday_campaign:   { color: '#d97706', icon: <IconSpeakerphone size={12} />, label: 'Holiday' },
  custom:             { color: '#626880', icon: <IconCalendar size={12} />, label: 'Custom' },
};

function getTypeMeta(type: string) {
  return TYPE_META[type] ?? TYPE_META.custom;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatTime(iso: string) {
  const d = new Date(iso);
  if (d.getHours() === 0 && d.getMinutes() === 0) return '';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// ── Create event dialog ───────────────────────────────────────────────────────

interface CreateDialogProps {
  token: string;
  defaultDate?: string;
  onDismiss: () => void;
  onCreated: (e: CalendarEvent) => void;
}

function CreateDialog({ token, defaultDate, onDismiss, onCreated }: CreateDialogProps) {
  const [form, setForm] = useState({
    title: '', type: 'custom' as CalendarEventType,
    startDate: defaultDate ?? new Date().toISOString().slice(0, 16),
    endDate: '', description: '', allDay: false,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const inputCls = 'w-full bg-[--raised] border border-[--border2] rounded-[6px] px-3 py-2 text-[13px] text-[--ink] focus:outline-none focus:border-[--sage-b] focus:ring-2 focus:ring-[--sage-d]';

  async function handleCreate() {
    if (!form.title) { setErr('Title is required'); return; }
    setSaving(true);
    setErr('');
    try {
      const res = await api.calendar.create({
        type: form.type,
        title: form.title,
        startDate: new Date(form.startDate).toISOString(),
        endDate: form.endDate ? new Date(form.endDate).toISOString() : undefined,
        allDay: form.allDay,
        description: form.description || undefined,
      }, token);
      onCreated(res.event);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to create event');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.36)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <div className="bg-surface border border-[--border] rounded-[10px] p-6 w-full max-w-md shadow-xl">
        <h2 className="font-syne font-semibold text-[--ink] text-[16px] mb-4">Add calendar event</h2>
        {err && <p className="text-[--red] text-[12px] mb-3">{err}</p>}

        <div className="space-y-3">
          <div>
            <label className="text-[12px] font-medium text-[--ink2] block mb-1">Title</label>
            <input className={inputCls} value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="Event title" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[12px] font-medium text-[--ink2] block mb-1">Type</label>
              <select className={inputCls} value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value as CalendarEventType }))}>
                {Object.entries(TYPE_META).map(([t, m]) => (
                  <option key={t} value={t}>{m.label}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 text-[12px] text-[--ink2]">
                <input type="checkbox" checked={form.allDay} onChange={e => setForm(p => ({ ...p, allDay: e.target.checked }))} />
                All day
              </label>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[12px] font-medium text-[--ink2] block mb-1">Start</label>
              <input className={inputCls} type={form.allDay ? 'date' : 'datetime-local'} value={form.startDate.slice(0, form.allDay ? 10 : 16)} onChange={e => setForm(p => ({ ...p, startDate: e.target.value }))} />
            </div>
            <div>
              <label className="text-[12px] font-medium text-[--ink2] block mb-1">End (optional)</label>
              <input className={inputCls} type={form.allDay ? 'date' : 'datetime-local'} value={form.endDate.slice(0, form.allDay ? 10 : 16)} onChange={e => setForm(p => ({ ...p, endDate: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="text-[12px] font-medium text-[--ink2] block mb-1">Description (optional)</label>
            <textarea className={inputCls} rows={2} value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
          </div>
        </div>

        <div className="flex gap-2 mt-5 justify-end">
          <button onClick={onDismiss} className="border border-[--border2] text-[--ink2] text-[13px] font-medium px-4 py-2 rounded-[6px] hover:bg-[--raised]">Cancel</button>
          <button onClick={handleCreate} disabled={saving} className="bg-[--sage] text-white text-[13px] font-medium px-4 py-2 rounded-[6px] disabled:opacity-60">
            {saving ? 'Adding…' : 'Add event'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Event pill ────────────────────────────────────────────────────────────────

function EventPill({ event, onDelete }: { event: CalendarEvent; onDelete: (id: string) => void }) {
  const meta = getTypeMeta(event.type);
  const [hover, setHover] = useState(false);
  const time = formatTime(event.startDate);

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ background: `${meta.color}18`, border: `1px solid ${meta.color}44`, borderRadius: 4, padding: '2px 6px', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 4, cursor: 'default', position: 'relative' }}
    >
      <span style={{ color: meta.color, display: 'flex', alignItems: 'center' }}>{meta.icon}</span>
      <span style={{ fontSize: 11, color: '#1b1f2e', fontWeight: 500, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {time && <span style={{ color: '#626880', marginRight: 3 }}>{time}</span>}{event.title}
      </span>
      {hover && event.source === 'authored' && (
        <button onClick={() => onDelete(event.id)} style={{ color: '#dc2626', display: 'flex', alignItems: 'center', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
          <IconTrash size={10} />
        </button>
      )}
    </div>
  );
}

// ── Month view ────────────────────────────────────────────────────────────────

function MonthView({ events, year, month, onDelete, onDayClick }: {
  events: CalendarEvent[];
  year: number;
  month: number;
  onDelete: (id: string) => void;
  onDayClick: (date: string) => void;
}) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();

  const byDay = new Map<string, CalendarEvent[]>();
  events.forEach(e => {
    const d = e.startDate.slice(0, 10);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d)!.push(e);
  });

  const cells: Array<{ date: string | null; day: number | null }> = [];
  for (let i = 0; i < firstDay; i++) cells.push({ date: null, day: null });
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ date, day: d });
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, background: 'var(--border)', borderRadius: 8, overflow: 'hidden' }}>
      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
        <div key={d} style={{ background: 'var(--raised)', padding: '6px', textAlign: 'center', fontSize: 11, fontWeight: 600, color: 'var(--ink2)' }}>{d}</div>
      ))}
      {cells.map((cell, i) => {
        const isToday = cell.date === `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        const dayEvents = cell.date ? byDay.get(cell.date) ?? [] : [];
        return (
          <div
            key={i}
            onClick={() => cell.date && onDayClick(cell.date)}
            style={{
              background: 'var(--surface)', minHeight: 80, padding: '4px',
              opacity: cell.day ? 1 : 0,
              cursor: cell.date ? 'pointer' : 'default',
            }}
          >
            {cell.day && (
              <>
                <div style={{
                  fontSize: 11, fontWeight: 600, marginBottom: 3, width: 20, height: 20,
                  borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: isToday ? 'var(--sage)' : 'transparent',
                  color: isToday ? 'white' : 'var(--ink2)',
                }}>{cell.day}</div>
                {dayEvents.slice(0, 3).map(e => (
                  <EventPill key={e.id} event={e} onDelete={onDelete} />
                ))}
                {dayEvents.length > 3 && (
                  <div style={{ fontSize: 10, color: 'var(--ink3)', padding: '1px 4px' }}>+{dayEvents.length - 3} more</div>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── List view ─────────────────────────────────────────────────────────────────

function ListView({ events, onDelete }: { events: CalendarEvent[]; onDelete: (id: string) => void }) {
  const grouped = new Map<string, CalendarEvent[]>();
  events.forEach(e => {
    const d = e.startDate.slice(0, 10);
    if (!grouped.has(d)) grouped.set(d, []);
    grouped.get(d)!.push(e);
  });

  const sortedDays = Array.from(grouped.keys()).sort();

  if (sortedDays.length === 0) {
    return (
      <div className="bg-surface border border-[--border] rounded-[10px] p-10 text-center">
        <IconCalendar size={32} className="text-[--ink3] mx-auto mb-3" />
        <p className="text-[13px] text-[--ink2]">No events in this range</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {sortedDays.map(day => (
        <div key={day}>
          <div className="text-[12px] font-semibold text-[--ink2] mb-2">{formatDate(day)}</div>
          <div className="space-y-2">
            {grouped.get(day)!.map(event => {
              const meta = getTypeMeta(event.type);
              const time = formatTime(event.startDate);
              return (
                <div key={event.id} className="bg-surface border border-[--border] rounded-[8px] p-3 flex items-start gap-3">
                  <div style={{ color: meta.color, marginTop: 1 }}>{meta.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-medium text-[--ink]">{event.title}</span>
                      <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: `${meta.color}18`, border: `1px solid ${meta.color}44`, color: meta.color }}>{meta.label}</span>
                      {event.source !== 'authored' && (
                        <span className="text-[10px] text-[--ink3]">Auto-scheduled</span>
                      )}
                    </div>
                    {time && <p className="text-[11px] text-[--ink3] mt-0.5">{time}</p>}
                    {event.description && <p className="text-[12px] text-[--ink2] mt-0.5">{event.description}</p>}
                  </div>
                  {event.source === 'authored' && (
                    <button onClick={() => onDelete(event.id)} className="text-[--ink3] hover:text-[--red] transition-colors">
                      <IconTrash size={13} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function CalendarPage() {
  const supabase = createClient();
  const [token, setToken] = useState('');
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'month' | 'list'>('month');
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth());
  const [showCreate, setShowCreate] = useState(false);
  const [createDate, setCreateDate] = useState<string | undefined>();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }: { data: { session: { access_token: string } | null } }) => {
      if (data.session) setToken(data.session.access_token);
    });
  }, [supabase.auth]);

  const load = useCallback(async (tok: string, y: number, m: number) => {
    setLoading(true);
    try {
      const from = new Date(y, m, 1).toISOString();
      const to   = new Date(y, m + 1, 0, 23, 59, 59).toISOString();
      const res = await api.calendar.list(tok, { from, to });
      setEvents(res.events);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (token) load(token, year, month);
  }, [token, year, month, load]);

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this event?')) return;
    await api.calendar.delete(id, token);
    setEvents(prev => prev.filter(e => e.id !== id));
  }

  return (
    <PageShell title="Calendar" description="Everything scheduled: campaigns, experiments, briefs, and more.">
      <div className="p-4 sm:p-6 lg:p-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-3">
            <button onClick={prevMonth} className="border border-[--border2] rounded-[6px] p-1.5 hover:bg-[--raised]"><IconChevronLeft size={14} className="text-[--ink2]" /></button>
            <h1 className="font-syne font-semibold text-[--ink] text-[18px] min-w-[160px] text-center">{MONTH_NAMES[month]} {year}</h1>
            <button onClick={nextMonth} className="border border-[--border2] rounded-[6px] p-1.5 hover:bg-[--raised]"><IconChevronRight size={14} className="text-[--ink2]" /></button>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex border border-[--border2] rounded-[6px] overflow-hidden">
              <button onClick={() => setView('month')} className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium ${view === 'month' ? 'bg-[--sage-d] text-[--sage]' : 'text-[--ink2] hover:bg-[--raised]'}`}>
                <IconCalendar size={12} /> Month
              </button>
              <button onClick={() => setView('list')} className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium ${view === 'list' ? 'bg-[--sage-d] text-[--sage]' : 'text-[--ink2] hover:bg-[--raised]'}`}>
                <IconList size={12} /> List
              </button>
            </div>
            <button
              onClick={() => { setCreateDate(undefined); setShowCreate(true); }}
              className="flex items-center gap-1.5 bg-[--sage] text-white text-[13px] font-medium px-4 py-2 rounded-[6px]"
            >
              <IconPlus size={14} /> Add event
            </button>
          </div>
        </div>

        {/* Legend */}
        <div className="flex gap-4 flex-wrap mb-4">
          {Object.entries(TYPE_META).filter(([k]) => ['campaign_launch', 'experiment_window', 'brief_sent', 'custom'].includes(k)).map(([type, meta]) => (
            <div key={type} className="flex items-center gap-1.5">
              <span style={{ color: meta.color, display: 'flex', alignItems: 'center' }}>{meta.icon}</span>
              <span className="text-[11px] text-[--ink2]">{meta.label}</span>
            </div>
          ))}
        </div>

        {/* Calendar */}
        {loading ? (
          <div className="flex items-center gap-2 text-[13px] text-[--ink3] py-8">
            <IconLoader size={16} className="animate-spin" /> Loading calendar…
          </div>
        ) : view === 'month' ? (
          <MonthView
            events={events}
            year={year}
            month={month}
            onDelete={handleDelete}
            onDayClick={d => { setCreateDate(`${d}T09:00`); setShowCreate(true); }}
          />
        ) : (
          <ListView events={events} onDelete={handleDelete} />
        )}
      </div>

      {showCreate && (
        <CreateDialog
          token={token}
          defaultDate={createDate}
          onDismiss={() => setShowCreate(false)}
          onCreated={e => { setEvents(prev => [...prev, e]); setShowCreate(false); }}
        />
      )}
    </PageShell>
  );
}
