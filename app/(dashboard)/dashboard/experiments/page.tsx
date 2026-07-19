'use client';

/**
 * @file app/(dashboard)/dashboard/experiments/page.tsx
 * @description A/B experiment builder: create experiments, track variant performance, select winners.
 *   Milestone 09 — full experiment UI replacing the Phase 8 stub.
 * @security Auth token from Supabase session; all API calls authenticated.
 * @dependencies api.experiments, Supabase Auth
 */

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageShell } from '@/components/launchmind/PageShell';
import {
  IconFlask,
  IconPlus,
  IconChevronDown,
  IconChevronUp,
  IconTrophy,
  IconCircleCheck,
  IconLoader,
  IconArchive,
  IconPlayerPlay,
} from '@tabler/icons-react';
import { api } from '@/lib/api';
import type { Experiment, ExperimentVariant } from '@/lib/api';

// ── Status helpers ────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, { bg: string; border: string; color: string; label: string }> = {
  draft:            { bg: 'var(--raised)', border: 'var(--border2)', color: 'var(--ink2)', label: 'Draft' },
  ready:            { bg: 'var(--indigo-d)', border: 'var(--indigo-b)', color: 'var(--indigo)', label: 'Ready' },
  running:          { bg: 'var(--sage-d)', border: 'var(--sage-b)', color: 'var(--sage)', label: 'Running' },
  waiting_for_data: { bg: 'var(--amber-d)', border: 'var(--amber-b)', color: 'var(--amber)', label: 'Collecting data' },
  completed:        { bg: 'var(--sage-d)', border: 'var(--sage-b)', color: '#046c4e', label: 'Completed' },
  inconclusive:     { bg: 'var(--raised)', border: 'var(--border2)', color: 'var(--ink2)', label: 'Inconclusive' },
  failed:           { bg: 'var(--danger-d)', border: 'var(--danger-b)', color: 'var(--danger)', label: 'Failed' },
  archived:         { bg: 'var(--raised)', border: 'var(--border2)', color: 'var(--ink3)', label: 'Archived' },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.draft;
  return (
    <span style={{
      fontSize: 11, fontWeight: 500, padding: '2px 8px',
      borderRadius: 4, background: s.bg, border: `1px solid ${s.border}`, color: s.color,
    }}>
      {s.label}
    </span>
  );
}

// ── Create experiment dialog ──────────────────────────────────────────────────

interface CreateDialogProps {
  productId: string;
  token: string;
  onDismiss: () => void;
  onCreated: (exp: Experiment) => void;
}

function CreateDialog({ productId, token, onDismiss, onCreated }: CreateDialogProps) {
  const [form, setForm] = useState({
    title: '', hypothesis: '', goal: '', metric: '',
    experimentType: 'copy' as 'copy' | 'creative' | 'channel' | 'aso' | 'audience',
    market: '' as '' | 'usa' | 'india' | 'both',
    labelA: 'Variant A', labelB: 'Variant B',
    descA: '', descB: '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function handleCreate() {
    if (!form.title || !form.hypothesis || !form.goal || !form.metric) {
      setErr('Title, hypothesis, goal, and metric are required.');
      return;
    }
    setSaving(true);
    setErr('');
    try {
      const res = await api.experiments.create({
        productId,
        title: form.title,
        hypothesis: form.hypothesis,
        experimentType: form.experimentType,
        goal: form.goal,
        metric: form.metric,
        market: form.market || undefined,
        variantA: { label: form.labelA, description: form.descA || undefined },
        variantB: { label: form.labelB, description: form.descB || undefined },
      }, token);
      onCreated(res.experiment);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to create experiment');
    } finally {
      setSaving(false);
    }
  }

  const inputCls = 'w-full bg-[--raised] border border-[--border2] rounded-[6px] px-3 py-2 text-[13px] text-[--ink] focus:outline-none focus:border-[--sage-b] focus:ring-2 focus:ring-[--sage-d]';

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.36)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <div className="bg-surface border border-[--border] rounded-[10px] p-6 w-full max-w-lg shadow-xl" style={{ maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 className="font-syne font-semibold text-[--ink] text-[16px] mb-4">New Experiment</h2>

        {err && <p className="text-[--red] text-[12px] mb-3">{err}</p>}

        <div className="space-y-3">
          <div>
            <label className="text-[12px] font-medium text-[--ink2] block mb-1">Title</label>
            <input className={inputCls} placeholder="WhatsApp hook A vs B" value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} />
          </div>
          <div>
            <label className="text-[12px] font-medium text-[--ink2] block mb-1">Hypothesis</label>
            <textarea className={inputCls} rows={2} placeholder="Variant B will increase CTR by 15% because..." value={form.hypothesis} onChange={e => setForm(p => ({ ...p, hypothesis: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[12px] font-medium text-[--ink2] block mb-1">Type</label>
              <select className={inputCls} value={form.experimentType} onChange={e => setForm(p => ({ ...p, experimentType: e.target.value as typeof form.experimentType }))}>
                <option value="copy">Copy</option>
                <option value="creative">Creative</option>
                <option value="channel">Channel</option>
                <option value="aso">ASO</option>
                <option value="audience">Audience</option>
              </select>
            </div>
            <div>
              <label className="text-[12px] font-medium text-[--ink2] block mb-1">Market</label>
              <select className={inputCls} value={form.market} onChange={e => setForm(p => ({ ...p, market: e.target.value as typeof form.market }))}>
                <option value="">Both markets</option>
                <option value="usa">USA</option>
                <option value="india">India</option>
                <option value="both">Both</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[12px] font-medium text-[--ink2] block mb-1">Goal</label>
              <input className={inputCls} placeholder="Increase installs by 20%" value={form.goal} onChange={e => setForm(p => ({ ...p, goal: e.target.value }))} />
            </div>
            <div>
              <label className="text-[12px] font-medium text-[--ink2] block mb-1">Primary metric</label>
              <input className={inputCls} placeholder="CTR / CPI / installs" value={form.metric} onChange={e => setForm(p => ({ ...p, metric: e.target.value }))} />
            </div>
          </div>
          <div className="border border-[--border] rounded-[8px] p-3">
            <p className="text-[12px] font-medium text-[--ink2] mb-2">Variants</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <input className={`${inputCls} mb-2`} placeholder="Variant A label" value={form.labelA} onChange={e => setForm(p => ({ ...p, labelA: e.target.value }))} />
                <textarea className={inputCls} rows={2} placeholder="Describe variant A..." value={form.descA} onChange={e => setForm(p => ({ ...p, descA: e.target.value }))} />
              </div>
              <div>
                <input className={`${inputCls} mb-2`} placeholder="Variant B label" value={form.labelB} onChange={e => setForm(p => ({ ...p, labelB: e.target.value }))} />
                <textarea className={inputCls} rows={2} placeholder="Describe variant B..." value={form.descB} onChange={e => setForm(p => ({ ...p, descB: e.target.value }))} />
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-2 mt-5 justify-end">
          <button onClick={onDismiss} className="border border-[--border2] text-[--ink2] text-[13px] font-medium px-4 py-2 rounded-[6px] hover:bg-[--raised]">
            Cancel
          </button>
          <button onClick={handleCreate} disabled={saving} className="bg-[--sage] text-white text-[13px] font-medium px-4 py-2 rounded-[6px] disabled:opacity-60">
            {saving ? 'Creating…' : 'Create experiment'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Winner dialog ─────────────────────────────────────────────────────────────

interface WinnerDialogProps {
  experiment: Experiment;
  token: string;
  onDismiss: () => void;
  onSaved: (exp: Experiment) => void;
}

function WinnerDialog({ experiment, token, onDismiss, onSaved }: WinnerDialogProps) {
  const [winner, setWinner] = useState<'a' | 'b' | 'inconclusive'>('a');
  const [learning, setLearning] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!learning.trim()) return;
    setSaving(true);
    try {
      const res = await api.experiments.selectWinner(experiment.id, { winner, learning }, token);
      onSaved(res.experiment);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.36)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <div className="bg-surface border border-[--border] rounded-[10px] p-6 w-full max-w-md shadow-xl">
        <h2 className="font-syne font-semibold text-[--ink] text-[16px] mb-4">Select winner — {experiment.title}</h2>
        <p className="text-[12px] text-[--ink2] mb-4">This will close the experiment and record a learning that feeds your Growth Brain.</p>

        <div className="flex gap-2 mb-4">
          {(['a', 'b', 'inconclusive'] as const).map(opt => (
            <button key={opt} onClick={() => setWinner(opt)}
              className={`flex-1 py-2 rounded-[6px] text-[12px] font-medium border ${winner === opt ? 'bg-[--sage-d] border-[--sage-b] text-[--sage]' : 'border-[--border2] text-[--ink2] hover:bg-[--raised]'}`}>
              {opt === 'a' ? 'Variant A wins' : opt === 'b' ? 'Variant B wins' : 'Inconclusive'}
            </button>
          ))}
        </div>

        <label className="text-[12px] font-medium text-[--ink2] block mb-1">Learning (required)</label>
        <textarea
          className="w-full bg-[--raised] border border-[--border2] rounded-[6px] px-3 py-2 text-[13px] text-[--ink] focus:outline-none focus:border-[--sage-b] focus:ring-2 focus:ring-[--sage-d]"
          rows={3}
          placeholder="What did you learn? How should this inform future campaigns?"
          value={learning}
          onChange={e => setLearning(e.target.value)}
        />

        <div className="flex gap-2 mt-4 justify-end">
          <button onClick={onDismiss} className="border border-[--border2] text-[--ink2] text-[13px] font-medium px-4 py-2 rounded-[6px] hover:bg-[--raised]">Cancel</button>
          <button onClick={handleSave} disabled={saving || !learning.trim()} className="bg-[--sage] text-white text-[13px] font-medium px-4 py-2 rounded-[6px] disabled:opacity-60">
            {saving ? 'Saving…' : 'Record winner'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Experiment row ────────────────────────────────────────────────────────────

interface ExpRowProps {
  exp: Experiment;
  token: string;
  onUpdated: (e: Experiment) => void;
}

function ExpRow({ exp, token, onUpdated }: ExpRowProps) {
  const [open, setOpen] = useState(false);
  const [variants, setVariants] = useState<ExperimentVariant[]>([]);
  const [loadingVariants, setLoadingVariants] = useState(false);
  const [showWinner, setShowWinner] = useState(false);
  const [busy, setBusy] = useState(false);

  async function loadVariants() {
    if (variants.length > 0) return;
    setLoadingVariants(true);
    try {
      const res = await api.experiments.get(exp.id, token);
      setVariants(res.variants);
    } finally {
      setLoadingVariants(false);
    }
  }

  function toggle() {
    setOpen(p => !p);
    if (!open) loadVariants();
  }

  async function handleStart() {
    setBusy(true);
    try {
      const res = await api.experiments.start(exp.id, token);
      onUpdated({ ...exp, status: res.experiment.status as Experiment['status'], start_date: res.experiment.start_date ?? null });
    } finally {
      setBusy(false);
    }
  }

  async function handleArchive() {
    if (!confirm('Archive this experiment?')) return;
    setBusy(true);
    try {
      await api.experiments.archive(exp.id, token);
      onUpdated({ ...exp, status: 'archived' });
    } finally {
      setBusy(false);
    }
  }

  const canStart = ['draft', 'ready'].includes(exp.status);
  const canSelectWinner = ['running', 'waiting_for_data'].includes(exp.status);

  return (
    <div className="bg-surface border border-[--border] rounded-[10px] overflow-hidden">
      <button onClick={toggle} className="w-full text-left p-4 flex items-start gap-3 hover:bg-[--raised]/40">
        <IconFlask size={16} className="text-[--ink2] mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-medium text-[--ink]">{exp.title}</span>
            <StatusBadge status={exp.status} />
            {exp.market && (
              <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 4, background: exp.market === 'india' ? 'var(--amber-d)' : 'var(--sage-d)', border: `1px solid ${exp.market === 'india' ? 'var(--amber-b)' : 'var(--sage-b)'}`, color: exp.market === 'india' ? '#92400e' : '#046c4e' }}>
                {exp.market.toUpperCase()}
              </span>
            )}
          </div>
          <p className="text-[12px] text-[--ink2] mt-0.5 truncate">{exp.hypothesis}</p>
          <p className="text-[11px] text-[--ink3] mt-0.5">
            Metric: {exp.metric} · Type: {exp.experiment_type}
            {exp.start_date && ` · Started ${exp.start_date}`}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {exp.winner && exp.winner !== 'inconclusive' && (
            <IconTrophy size={14} className="text-[--amber]" />
          )}
          {open ? <IconChevronUp size={14} className="text-[--ink3]" /> : <IconChevronDown size={14} className="text-[--ink3]" />}
        </div>
      </button>

      {open && (
        <div className="border-t border-[--border] p-4">
          {loadingVariants ? (
            <div className="flex items-center gap-2 text-[12px] text-[--ink3]"><IconLoader size={14} className="animate-spin" /> Loading variants…</div>
          ) : (
            <div className="grid grid-cols-2 gap-3 mb-4">
              {variants.map(v => (
                <div key={v.id} className={`bg-raised border rounded-[6px] p-3 ${exp.winner === v.variant ? 'border-[--sage-b] ring-1 ring-[--sage-d]' : 'border-[--border2]'}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[12px] font-semibold text-[--ink]">{v.label}</span>
                    {exp.winner === v.variant && <IconTrophy size={12} className="text-[--amber]" />}
                  </div>
                  {v.description && <p className="text-[12px] text-[--ink2] mb-2">{v.description}</p>}
                  <div className="grid grid-cols-3 gap-2">
                    {[['Impressions', v.impressions], ['Clicks', v.clicks], ['Conversions', v.conversions]].map(([label, val]) => (
                      <div key={String(label)} className="text-center">
                        <div className="font-mono text-[13px] font-medium text-[--ink]">{String(val)}</div>
                        <div className="text-[10px] text-[--ink3]">{String(label)}</div>
                      </div>
                    ))}
                  </div>
                  {v.metric_value !== null && (
                    <div className="mt-2 text-center">
                      <span className="font-mono text-[12px] text-[--sage]">{v.metric_value.toFixed(3)}</span>
                      <span className="text-[10px] text-[--ink3] ml-1">{exp.metric}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {exp.learning_summary && (
            <div className="bg-[--sage-d] border border-[--sage-b] rounded-[6px] p-3 mb-3">
              <div className="flex items-center gap-1.5 mb-1">
                <IconCircleCheck size={13} className="text-[--sage]" />
                <span className="text-[11px] font-semibold text-[--sage]">Learning</span>
              </div>
              <p className="text-[12px] text-[--ink]">{exp.learning_summary}</p>
            </div>
          )}

          <div className="flex gap-2">
            {canStart && (
              <button onClick={handleStart} disabled={busy} className="flex items-center gap-1.5 bg-[--sage] text-white text-[12px] font-medium px-3 py-1.5 rounded-[6px] disabled:opacity-60">
                <IconPlayerPlay size={12} /> Start experiment
              </button>
            )}
            {canSelectWinner && (
              <button onClick={() => setShowWinner(true)} className="flex items-center gap-1.5 bg-[--amber-d] border border-[--amber-b] text-[--amber] text-[12px] font-medium px-3 py-1.5 rounded-[6px]">
                <IconTrophy size={12} /> Select winner
              </button>
            )}
            {exp.status !== 'archived' && (
              <button onClick={handleArchive} disabled={busy} className="flex items-center gap-1.5 border border-[--border2] text-[--ink3] text-[12px] font-medium px-3 py-1.5 rounded-[6px] hover:bg-[--raised]">
                <IconArchive size={12} /> Archive
              </button>
            )}
          </div>
        </div>
      )}

      {showWinner && (
        <WinnerDialog
          experiment={exp}
          token={token}
          onDismiss={() => setShowWinner(false)}
          onSaved={updated => { onUpdated(updated); setShowWinner(false); }}
        />
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ExperimentsPage() {
  const supabase = createClient();
  const [token, setToken] = useState('');
  const [productId, setProductId] = useState('');
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }: { data: { session: { access_token: string } | null } }) => {
      if (!data.session) return;
      setToken(data.session.access_token);
    });
    const pid = sessionStorage.getItem('activeProductId') ?? '';
    setProductId(pid);
  }, [supabase.auth]);

  const load = useCallback(async (tok: string) => {
    setLoading(true);
    try {
      const params = filter ? { status: filter } : undefined;
      const res = await api.experiments.list(tok, params);
      setExperiments(res.experiments);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    if (token) load(token);
  }, [token, load]);

  const STATUS_FILTERS = ['', 'running', 'waiting_for_data', 'completed', 'draft'];

  return (
    <PageShell title="Experiments" description="Test two versions. Let data decide.">
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
          <div>
            <h1 className="font-syne font-semibold text-[--ink] text-[20px]">Experiments</h1>
            <p className="text-[13px] text-[--ink2] mt-0.5">Run A/B tests on copy, creative, channels, and audiences.</p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 bg-[--sage] text-white text-[13px] font-medium px-4 py-2 rounded-[6px] whitespace-nowrap self-start sm:self-auto"
          >
            <IconPlus size={14} /> New experiment
          </button>
        </div>

        <div className="flex gap-2 flex-wrap mb-4">
          {STATUS_FILTERS.map(s => (
            <button key={s || 'all'} onClick={() => setFilter(s)}
              className={`text-[12px] font-medium px-3 py-1 rounded-full border ${filter === s ? 'bg-[--sage-d] border-[--sage-b] text-[--sage]' : 'border-[--border2] text-[--ink2] hover:bg-[--raised]'}`}>
              {s === '' ? 'All' : STATUS_STYLES[s]?.label ?? s}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-[13px] text-[--ink3] py-8">
            <IconLoader size={16} className="animate-spin" /> Loading experiments…
          </div>
        ) : experiments.length === 0 ? (
          <div className="bg-surface border border-[--border] rounded-[10px] p-10 text-center">
            <IconFlask size={32} className="text-[--ink3] mx-auto mb-3" />
            <p className="font-syne font-semibold text-[--ink] text-[15px] mb-1">No experiments yet</p>
            <p className="text-[13px] text-[--ink2] mb-4">Create your first experiment to start testing.</p>
            <button onClick={() => setShowCreate(true)} className="bg-[--sage] text-white text-[13px] font-medium px-4 py-2 rounded-[6px]">
              Create experiment
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {experiments.map(exp => (
              <ExpRow
                key={exp.id}
                exp={exp}
                token={token}
                onUpdated={updated => setExperiments(prev => prev.map(e => e.id === updated.id ? updated : e))}
              />
            ))}
          </div>
        )}
      </div>

      {showCreate && productId && (
        <CreateDialog
          productId={productId}
          token={token}
          onDismiss={() => setShowCreate(false)}
          onCreated={exp => { setExperiments(prev => [exp, ...prev]); setShowCreate(false); }}
        />
      )}

      {showCreate && !productId && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.36)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div className="bg-surface border border-[--border] rounded-[10px] p-6 w-full max-w-sm shadow-xl text-center">
            <p className="font-syne font-semibold text-[--ink] mb-2">No active product</p>
            <p className="text-[13px] text-[--ink2] mb-4">Select a product first from the Products page before creating an experiment.</p>
            <button onClick={() => setShowCreate(false)} className="border border-[--border2] text-[--ink2] text-[13px] font-medium px-4 py-2 rounded-[6px] hover:bg-[--raised]">
              Close
            </button>
          </div>
        </div>
      )}
    </PageShell>
  );
}
