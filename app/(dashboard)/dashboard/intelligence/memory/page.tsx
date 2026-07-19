/**
 * @file app/(dashboard)/dashboard/intelligence/memory/page.tsx
 * @description Marketing Memory dashboard — view and manage persistent learnings.
 *   Shows memories grouped by type, with confidence indicators, source badges,
 *   version history, and a learning events timeline. Founders see business
 *   language ("what your AI knows about your brand") not technical terminology.
 * @security Auth token from Supabase session. All data via Fastify backend.
 * @dependencies lib/api, lib/supabase/client
 */

'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { api, ApiError } from '@/lib/api';
import type { MarketingMemory, MemoryType, LearningEvent } from '@/lib/api';
import {
  IconBrain,
  IconSearch,
  IconSparkles,
  IconArchive,
  IconCheck,
  IconAlertCircle,
  IconClock,
  IconChevronDown,
  IconChevronRight,
} from '@tabler/icons-react';

// ── Memory type display config ────────────────────────────────────────────────

const MEMORY_TYPE_META: Record<MemoryType, { label: string; color: string; bg: string; border: string }> = {
  founder:     { label: 'Founder',    color: 'var(--indigo)', bg: 'var(--indigo-d)', border: 'var(--indigo-b)' },
  brand:       { label: 'Brand',      color: 'var(--sage)',   bg: 'var(--sage-d)',   border: 'var(--sage-b)' },
  product:     { label: 'Product',    color: 'var(--sage)',   bg: 'var(--sage-d)',   border: 'var(--sage-b)' },
  customer:    { label: 'Customer',   color: 'var(--amber)',  bg: 'var(--amber-d)',  border: 'var(--amber-b)' },
  campaign:    { label: 'Campaign',   color: 'var(--indigo)', bg: 'var(--indigo-d)', border: 'var(--indigo-b)' },
  creative:    { label: 'Creative',   color: 'var(--indigo)', bg: 'var(--indigo-d)', border: 'var(--indigo-b)' },
  review:      { label: 'Review',     color: 'var(--amber)',  bg: 'var(--amber-d)',  border: 'var(--amber-b)' },
  competitor:  { label: 'Competitor', color: 'var(--danger)',    bg: 'var(--danger-d)',    border: 'var(--danger-b)' },
  experiment:  { label: 'Experiment', color: 'var(--indigo)', bg: 'var(--indigo-d)', border: 'var(--indigo-b)' },
  market:      { label: 'Market',     color: 'var(--amber)',  bg: 'var(--amber-d)',  border: 'var(--amber-b)' },
  seasonality: { label: 'Seasonality', color: 'var(--ink2)', bg: 'var(--raised)',   border: 'var(--border2)' },
};

const SOURCE_LABEL: Record<string, string> = {
  intake:               'Product intake',
  growth_brain:         'Growth Brain',
  campaign_performance: 'Campaign results',
  review:               'App reviews',
  analytics:            'Analytics sync',
  founder_feedback:     'Your feedback',
  ai_conversation:      'AI conversation',
  experiment:           'Experiment',
};

const FILTER_TABS: { value: 'all' | MemoryType; label: string }[] = [
  { value: 'all',        label: 'All' },
  { value: 'brand',      label: 'Brand' },
  { value: 'product',    label: 'Product' },
  { value: 'customer',   label: 'Customers' },
  { value: 'campaign',   label: 'Campaigns' },
  { value: 'competitor', label: 'Competitors' },
  { value: 'market',     label: 'Market' },
  { value: 'review',     label: 'Reviews' },
];

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = value >= 0.7 ? 'var(--sage)' : value >= 0.5 ? 'var(--amber)' : 'var(--ink3)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, height: 4, background: 'var(--raised)', borderRadius: 2 }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.3s ease' }} />
      </div>
      <span className="font-mono" style={{ fontSize: 10, color, width: 28, textAlign: 'right' }}>{pct}%</span>
    </div>
  );
}

function MemoryCard({ memory, onArchive }: { memory: MarketingMemory; onArchive: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const meta = MEMORY_TYPE_META[memory.memory_type];

  const contentKeys = Object.keys(memory.content).filter(k => !k.startsWith('_'));
  const preview = contentKeys.slice(0, 2).map(k => {
    const val = memory.content[k];
    if (Array.isArray(val)) return `${k}: ${(val as string[]).slice(0, 2).join(', ')}${val.length > 2 ? '…' : ''}`;
    if (typeof val === 'string') return `${k}: ${val.slice(0, 60)}${val.length > 60 ? '…' : ''}`;
    return null;
  }).filter(Boolean);

  return (
    <div style={{
      background: 'var(--surface)',
      border: `1px solid ${meta.border}`,
      borderRadius: 10,
      overflow: 'hidden',
    }}>
      <div
        style={{ padding: '14px 16px', cursor: 'pointer' }}
        onClick={() => setExpanded(e => !e)}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginBottom: 4 }}>
              <span style={{
                fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 9999,
                background: meta.bg, color: meta.color, border: `1px solid ${meta.border}`,
              }}>
                {meta.label}
              </span>
              <span style={{ fontSize: 10, color: 'var(--ink3)', background: 'var(--raised)', border: '1px solid var(--border2)', borderRadius: 9999, padding: '1px 6px' }}>
                {SOURCE_LABEL[memory.source] ?? memory.source}
              </span>
              <span style={{ fontSize: 10, color: 'var(--ink3)' }}>v{memory.version}</span>
            </div>
            <h3 style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', margin: 0, lineHeight: 1.4 }}>
              {memory.title}
            </h3>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {expanded
              ? <IconChevronDown size={14} color="var(--ink3)" />
              : <IconChevronRight size={14} color="var(--ink3)" />}
          </div>
        </div>
        <ConfidenceBar value={memory.confidence} />
        {!expanded && preview.length > 0 && (
          <div style={{ marginTop: 8 }}>
            {preview.map((line, i) => (
              <p key={i} style={{ fontSize: 11, color: 'var(--ink3)', margin: '2px 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {line}
              </p>
            ))}
          </div>
        )}
      </div>

      {expanded && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '14px 16px', background: 'var(--raised)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
            {contentKeys.map(k => {
              const val = memory.content[k];
              return (
                <div key={k}>
                  <div style={{ fontSize: 10, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 500, marginBottom: 2 }}>{k}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.5 }}>
                    {Array.isArray(val)
                      ? (val as string[]).join(', ')
                      : typeof val === 'object'
                        ? JSON.stringify(val)
                        : String(val ?? '—')}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, color: 'var(--ink3)' }}>
              Updated {new Date(memory.updated_at).toLocaleDateString()}
              {memory.evidence_ids.length > 0 && ` · ${memory.evidence_ids.length} evidence item${memory.evidence_ids.length !== 1 ? 's' : ''}`}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onArchive(memory.id); }}
              style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5, border: '1px solid var(--border2)', color: 'var(--ink3)', background: 'var(--surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
            >
              <IconArchive size={11} />
              Archive
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function LearningEventRow({ event }: { event: LearningEvent }) {
  const statusColor = event.status === 'completed' ? 'var(--sage)' : event.status === 'failed' ? 'var(--danger)' : 'var(--ink3)';
  const StatusIcon = event.status === 'completed' ? IconCheck : event.status === 'failed' ? IconAlertCircle : IconClock;

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      <StatusIcon size={14} color={statusColor} style={{ marginTop: 2, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: 'var(--ink)', fontWeight: 500 }}>
          {event.event_type.replace(/_/g, ' ')}
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 1 }}>
          {event.memories_created > 0 && `${event.memories_created} created`}
          {event.memories_created > 0 && event.memories_updated > 0 && ' · '}
          {event.memories_updated > 0 && `${event.memories_updated} updated`}
          {event.nodes_created > 0 && ` · ${event.nodes_created} graph nodes`}
          {event.error && ` · Error: ${event.error.slice(0, 60)}`}
        </div>
      </div>
      <span style={{ fontSize: 10, color: 'var(--ink3)', flexShrink: 0 }}>
        {new Date(event.created_at).toLocaleDateString()}
      </span>
    </div>
  );
}

export default function MemoryPage() {
  const supabase = createClient();
  const [memories, setMemories] = useState<MarketingMemory[]>([]);
  const [events, setEvents] = useState<LearningEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<'all' | MemoryType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const tokenRef = useRef<string | null>(null);
  const searchTimer = useRef<NodeJS.Timeout | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      tokenRef.current = session.access_token;

      const [memRes, evRes] = await Promise.all([
        api.memory.list(session.access_token, { memory_type: typeFilter === 'all' ? undefined : typeFilter, limit: 40 }),
        api.memory.listEvents(session.access_token, { limit: 10 }),
      ]);
      setMemories(memRes.memories);
      setTotal(memRes.total);
      setEvents(evRes.events);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load memories');
    } finally {
      setLoading(false);
    }
  }, [supabase, typeFilter]);

  useEffect(() => { load(); }, [load]);

  const handleSearch = useCallback((q: string) => {
    setSearchQuery(q);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!q.trim()) { load(); return; }
    searchTimer.current = setTimeout(async () => {
      if (!tokenRef.current) return;
      setSearching(true);
      try {
        const res = await api.memory.search(q, tokenRef.current);
        setMemories(res.memories);
      } catch { /* non-fatal */ } finally {
        setSearching(false);
      }
    }, 350);
  }, [load]);

  const handleArchive = useCallback(async (id: string) => {
    if (!tokenRef.current) return;
    try {
      await api.memory.archive(id, tokenRef.current);
      setMemories(prev => prev.filter(m => m.id !== id));
    } catch { /* non-fatal */ }
  }, []);

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-5">
        <h1 className="font-display font-semibold" style={{ fontSize: 22, color: 'var(--ink)' }}>
          Marketing Memory
        </h1>
        <p style={{ fontSize: 13, color: 'var(--ink2)', marginTop: 3 }}>
          What your AI permanently knows about your brand, customers, campaigns, and market.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-[8px] px-4 py-3" style={{ background: 'var(--danger-d)', border: '1px solid var(--danger-b)', color: 'var(--danger)', fontSize: 13 }}>
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-5" style={{ alignItems: 'start' }}>

        {/* Left column: memories */}
        <div>
          {/* Search + filter */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
            <div style={{ position: 'relative' }}>
              <IconSearch size={14} color="var(--ink3)" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
              <input
                type="text"
                value={searchQuery}
                onChange={e => handleSearch(e.target.value)}
                placeholder="Search memories…"
                style={{
                  width: '100%', padding: '8px 10px 8px 30px', fontSize: 13,
                  background: 'var(--raised)', border: '1px solid var(--border2)',
                  borderRadius: 7, color: 'var(--ink)', outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {FILTER_TABS.map(tab => {
                const active = typeFilter === tab.value;
                return (
                  <button
                    key={tab.value}
                    onClick={() => { setSearchQuery(''); setTypeFilter(tab.value); }}
                    style={{
                      fontSize: 11, fontWeight: active ? 600 : 400,
                      padding: '4px 10px', borderRadius: 9999, cursor: 'pointer', border: 'none',
                      background: active ? 'var(--sage-d)' : 'var(--raised)',
                      color: active ? 'var(--sage)' : 'var(--ink2)',
                    }}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          {loading || searching ? (
            <div className="text-center py-12" style={{ fontSize: 13, color: 'var(--ink3)' }}>
              {searching ? 'Searching…' : 'Loading memories…'}
            </div>
          ) : memories.length === 0 ? (
            <div className="flex flex-col items-center py-16 text-center">
              <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--raised)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
                <IconBrain size={22} color="var(--ink3)" />
              </div>
              <h3 className="font-semibold mb-2" style={{ fontSize: 14, color: 'var(--ink)' }}>No memories yet</h3>
              <p style={{ fontSize: 13, color: 'var(--ink2)', maxWidth: 320 }}>
                Memories are created automatically when you complete product intake, generate strategies, or run campaigns.
              </p>
            </div>
          ) : (
            <>
              <p style={{ fontSize: 11, color: 'var(--ink3)', marginBottom: 10 }}>
                Showing {memories.length} of {total} memories
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {memories.map(m => (
                  <MemoryCard key={m.id} memory={m} onArchive={handleArchive} />
                ))}
              </div>
            </>
          )}
        </div>

        {/* Right column: learning events timeline */}
        <div className="xl:sticky xl:top-6">
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
              <IconSparkles size={14} color="var(--sage)" />
              <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', margin: 0 }}>Learning timeline</p>
            </div>
            {events.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--ink3)', textAlign: 'center', padding: '16px 0' }}>
                No learning events yet. Complete product intake to begin.
              </p>
            ) : (
              <div>
                {events.map(ev => <LearningEventRow key={ev.id} event={ev} />)}
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
