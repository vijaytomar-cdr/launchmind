/**
 * @file app/(dashboard)/dashboard/intelligence/timeline/page.tsx
 * @description Chronological timeline of all product events — missions, campaigns, approvals.
 * @security JWT from Supabase session.
 * @dependencies api.owner.timeline
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { api, type TimelineEvent } from '@/lib/api';
import {
  IconCheck,
  IconAlertCircle,
  IconBolt,
  IconSpeakerphone,
  IconShieldCheck,
  IconArrowRight,
} from '@tabler/icons-react';

const EVENT_META: Record<string, { icon: React.ElementType; color: string; bg: string; border: string }> = {
  mission_created:    { icon: IconBolt,         color: 'var(--sage)',   bg: 'var(--sage-d)',   border: 'var(--sage-b)' },
  mission_completed:  { icon: IconCheck,        color: 'var(--sage)',   bg: 'var(--sage-d)',   border: 'var(--sage-b)' },
  mission_failed:     { icon: IconAlertCircle,  color: 'var(--danger)',    bg: 'var(--danger-d)',    border: 'var(--danger-b)' },
  campaign_launched:  { icon: IconSpeakerphone, color: 'var(--indigo)', bg: 'var(--indigo-d)', border: 'var(--indigo-b)' },
  campaign_approved:  { icon: IconShieldCheck,  color: 'var(--sage)',   bg: 'var(--sage-d)',   border: 'var(--sage-b)' },
  approval_approved:  { icon: IconCheck,        color: 'var(--sage)',   bg: 'var(--sage-d)',   border: 'var(--sage-b)' },
  approval_rejected:  { icon: IconAlertCircle,  color: 'var(--amber)',  bg: 'var(--amber-d)',  border: 'var(--amber-b)' },
};

const DEFAULT_META = { icon: IconBolt, color: 'var(--ink2)', bg: 'var(--raised)', border: 'var(--border2)' };

function EventRow({ event }: { event: TimelineEvent }) {
  const meta = EVENT_META[event.type] ?? DEFAULT_META;
  const Icon = meta.icon;

  const row = (
    <div className="flex items-start gap-3 py-3">
      <div className="relative flex flex-col items-center">
        <div
          className="w-7 h-7 rounded-full border flex items-center justify-center shrink-0 z-10"
          style={{ background: meta.bg, borderColor: meta.border }}
        >
          <Icon size={13} color={meta.color} />
        </div>
        <div className="absolute top-7 bottom-0 left-1/2 -translate-x-1/2 w-px bg-[var(--border)]" />
      </div>
      <div className="flex-1 min-w-0 pb-3">
        <p className="text-[13px] font-medium text-ink leading-snug">{event.title}</p>
        {event.subtitle && <p className="text-[12px] text-ink2 mt-0.5">{event.subtitle}</p>}
        <p className="text-[11px] text-ink3 mt-1">
          {new Date(event.time).toLocaleDateString('en-US', {
            weekday: 'short', month: 'short', day: 'numeric',
            hour: 'numeric', minute: '2-digit',
          })}
        </p>
      </div>
    </div>
  );

  if (event.link) {
    return <Link href={event.link} className="block hover:bg-raised rounded-[var(--r2)] px-2 -mx-2 transition-colors">{row}</Link>;
  }
  return <div className="px-2 -mx-2">{row}</div>;
}

// Group events by date
function groupByDate(events: TimelineEvent[]): Array<{ date: string; events: TimelineEvent[] }> {
  const groups: Record<string, TimelineEvent[]> = {};
  for (const e of events) {
    const d = new Date(e.time).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    if (!groups[d]) groups[d] = [];
    groups[d].push(e);
  }
  return Object.entries(groups).map(([date, events]) => ({ date, events }));
}

export default function TimelinePage() {
  const [events,  setEvents]  = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [total,   setTotal]   = useState(0);
  const [offset,  setOffset]  = useState(0);
  const [token,   setToken]   = useState<string | null>(null);
  const LIMIT = 50;

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { window.location.href = '/login'; return; }
      const t = session.access_token;
      setToken(t);
      api.owner.timeline(t, { limit: LIMIT, offset: 0 })
        .then(res => { setEvents(res.events); setTotal(res.total); setLoading(false); })
        .catch(() => setLoading(false));
    });
  }, []);

  const loadMore = useCallback(async () => {
    if (!token) return;
    const newOffset = offset + LIMIT;
    try {
      const res = await api.owner.timeline(token, { limit: LIMIT, offset: newOffset });
      setEvents(prev => [...prev, ...res.events]);
      setOffset(newOffset);
    } catch { /* ignore */ }
  }, [token, offset]);

  const groups = groupByDate(events);

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-[20px] font-semibold text-ink" style={{ fontFamily: 'Syne, sans-serif' }}>Timeline</h1>
        <p className="text-[13px] text-ink2 mt-1">Chronological history of all product decisions and campaigns</p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-ink2 text-[13px]">
          <span className="w-2 h-2 rounded-full bg-sage animate-pulse" />
          Loading timeline…
        </div>
      ) : events.length === 0 ? (
        <div className="bg-surface border border-[var(--border)] rounded-[var(--r)] p-8 text-center">
          <p className="text-[14px] font-medium text-ink">No events yet</p>
          <p className="text-[13px] text-ink2 mt-1">Create a mission or launch a campaign to start building your timeline.</p>
          <Link href="/dashboard/missions" className="mt-3 inline-flex items-center gap-1 text-[12px] text-sage font-medium hover:underline">
            Create mission <IconArrowRight size={11} />
          </Link>
        </div>
      ) : (
        <div className="max-w-2xl">
          {groups.map(group => (
            <div key={group.date} className="mb-6">
              <p className="text-[11px] text-ink3 uppercase tracking-wide font-medium mb-2 sticky top-4 bg-page py-1">{group.date}</p>
              <div className="bg-surface border border-[var(--border)] rounded-[var(--r)] px-4 overflow-hidden">
                {group.events.map(e => <EventRow key={e.id} event={e} />)}
              </div>
            </div>
          ))}

          {events.length < total && (
            <button
              onClick={() => void loadMore()}
              className="w-full py-2.5 bg-surface border border-[var(--border2)] rounded-[var(--r)] text-[13px] text-ink2 hover:text-ink hover:bg-raised transition-colors"
            >
              Load more ({total - events.length} remaining)
            </button>
          )}
        </div>
      )}
    </div>
  );
}
