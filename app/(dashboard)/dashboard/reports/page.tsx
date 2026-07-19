'use client';

import { useEffect, useState } from 'react';
import { createClient }        from '@/lib/supabase/client';
import { api, Report, ReportContent, ReportType } from '@/lib/api';
import {
  IconFileAnalytics, IconSparkles, IconDownload, IconX,
  IconCalendar, IconCheck, IconChevronDown, IconChevronUp,
} from '@tabler/icons-react';

// ── Helpers ───────────────────────────────────────────────────────────────────

function reportBadgeClass(type: ReportType) {
  const map: Record<ReportType, string> = {
    weekly:     'bg-[--sage-d] border-[--sage-b] text-sage',
    monthly:    'bg-[--indigo-d] border-[--indigo-b] text-indigo',
    executive:  'bg-[--amber-d] border-[--amber-b] text-amber',
    campaign:   'bg-raised border-[--border2] text-ink2',
    experiment: 'bg-[--indigo-d] border-[--indigo-b] text-indigo',
  };
  return map[type] ?? 'bg-raised border-[--border2] text-ink2';
}

const REPORT_TYPES: ReportType[] = ['weekly', 'monthly', 'executive', 'campaign', 'experiment'];

// ── Sub-components ─────────────────────────────────────────────────────────────

function ReportCard({ report, onSelect }: { report: Report; onSelect: (r: Report) => void }) {
  return (
    <button
      onClick={() => onSelect(report)}
      className="bg-surface border border-[--border] rounded-[10px] p-[14px_16px] text-left w-full hover:border-[--sage-b] transition-colors"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className={`text-xs px-2 py-0.5 rounded-full border font-medium capitalize ${reportBadgeClass(report.report_type)}`}>
          {report.report_type}
        </span>
        {report.status === 'exported' && (
          <span className="text-xs text-ink3 flex items-center gap-1">
            <IconDownload size={11} />exported
          </span>
        )}
      </div>
      <div className="text-sm font-semibold text-ink mb-1">{report.title}</div>
      {report.summary && <div className="text-xs text-ink2 line-clamp-2">{report.summary}</div>}
      <div className="flex items-center gap-1 mt-2 text-xs text-ink3">
        <IconCalendar size={12} />
        {report.period_start} — {report.period_end}
      </div>
    </button>
  );
}

function ContentSection({ title, items, color = 'text-ink2' }: { title: string; items: string[]; color?: string }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="mb-4">
      <div className="text-xs font-semibold text-ink mb-2">{title}</div>
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li key={i} className={`text-sm flex gap-2 ${color}`}>
            <span className="text-ink3 mt-0.5">•</span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReportDrawer({ report, token, onClose }: {
  report: Report;
  token: string;
  onClose: () => void;
}) {
  const [rating,      setRating]      = useState(0);
  const [exporting,   setExporting]   = useState(false);
  const [feedbackSent, setFeedbackSent] = useState(false);

  const content = report.content as ReportContent;

  const handleExport = async () => {
    setExporting(true);
    const res = await api.reports.exportReport(report.id, token).catch(() => null);
    if (res) {
      const blob = new Blob([JSON.stringify(res, null, 2)], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `${report.title.replace(/\s+/g, '_')}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
    setExporting(false);
  };

  const handleFeedback = async (r: number) => {
    setRating(r);
    await api.reports.feedback(report.id, r, token);
    setFeedbackSent(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-surface border-l border-[--border] h-full overflow-y-auto shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-surface border-b border-[--border] px-5 py-4 flex items-start justify-between">
          <div>
            <span className={`text-xs px-2 py-0.5 rounded-full border font-medium capitalize ${reportBadgeClass(report.report_type)} inline-block mb-1.5`}>
              {report.report_type}
            </span>
            <div className="text-sm font-semibold text-ink">{report.title}</div>
            <div className="text-xs text-ink3 mt-0.5">{report.period_start} — {report.period_end}</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExport}
              disabled={exporting}
              className="flex items-center gap-1.5 text-xs border border-[--border2] text-ink2 rounded-[6px] px-3 py-1.5 hover:bg-raised"
            >
              <IconDownload size={13} />{exporting ? 'Exporting…' : 'Export JSON'}
            </button>
            <button onClick={onClose} className="text-ink3 hover:text-ink p-1">
              <IconX size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-5">
          {/* Headline */}
          {content.headline && (
            <div className="bg-[--sage-d] border border-[--sage-b] rounded-[10px] p-3">
              <div className="text-sm font-semibold text-sage">{content.headline}</div>
            </div>
          )}

          {/* Summary */}
          {content.summary && (
            <div className="text-sm text-ink2 leading-relaxed">{content.summary}</div>
          )}

          <ContentSection title="What Worked" items={content.whatWorked ?? []} color="text-sage" />
          <ContentSection title="What to Fix" items={content.whatToFix ?? []} color="text-red-600" />
          <ContentSection title="Key Insights" items={content.keyInsights ?? []} color="text-ink" />
          <ContentSection title="Next Actions" items={content.nextActions ?? []} />
          {(content.riskFlags ?? []).length > 0 && (
            <ContentSection title="⚠ Risk Flags" items={content.riskFlags ?? []} color="text-amber" />
          )}

          {/* Feedback */}
          <div className="border-t border-[--border] pt-4">
            <div className="text-xs font-medium text-ink mb-2">Rate this report</div>
            {feedbackSent ? (
              <div className="flex items-center gap-1.5 text-xs text-sage">
                <IconCheck size={13} />Thanks for your feedback!
              </div>
            ) : (
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map(r => (
                  <button
                    key={r}
                    onClick={() => handleFeedback(r)}
                    className={`text-lg transition-opacity ${r <= rating ? 'opacity-100' : 'opacity-30 hover:opacity-70'}`}
                  >
                    ★
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const supabase = createClient();
  const [token,     setToken]     = useState<string | null>(null);
  const [products,  setProducts]  = useState<Array<{ id: string; name: string }>>([]);
  const [selected,  setSelected]  = useState<string | null>(null);
  const [reports,   setReports]   = useState<Report[]>([]);
  const [activeReport, setActiveReport] = useState<Report | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [generating, setGenerating] = useState(false);

  // Generate form state
  const [showGenForm,    setShowGenForm]    = useState(false);
  const [genType,        setGenType]        = useState<ReportType>('weekly');
  const [genPeriodStart, setGenPeriodStart] = useState('');
  const [genPeriodEnd,   setGenPeriodEnd]   = useState('');

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      setToken(session.access_token);

      const { data: prods } = await supabase
        .from('products')
        .select('id, name')
        .eq('founder_id', session.user.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(10);

      setProducts((prods ?? []) as { id: string; name: string }[]);
      if (prods && prods.length > 0) {
        setSelected((prods[0] as { id: string; name: string }).id);
      } else {
        setLoading(false);
      }

      // Pre-fill period dates (last 7 days)
      const now = new Date();
      const start = new Date(now);
      start.setDate(start.getDate() - 7);
      setGenPeriodEnd(now.toISOString().split('T')[0]);
      setGenPeriodStart(start.toISOString().split('T')[0]);
    })();
  }, []);

  useEffect(() => {
    if (!token || !selected) return;
    setLoading(true);
    api.reports.list(token, { productId: selected, limit: 20 })
      .then(res => { setReports((res as { reports: Report[] }).reports ?? []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token, selected]);

  const handleGenerate = async () => {
    if (!token || !selected || !genPeriodStart || !genPeriodEnd) return;
    setGenerating(true);
    const res = await api.reports.generate({
      productId:   selected,
      reportType:  genType,
      periodStart: genPeriodStart,
      periodEnd:   genPeriodEnd,
    }, token).catch(() => null);
    if (res) {
      const listRes = await api.reports.list(token, { productId: selected, limit: 20 }).catch(() => null);
      if (listRes) setReports((listRes as { reports: Report[] }).reports ?? []);
      setShowGenForm(false);
    }
    setGenerating(false);
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="font-display text-xl font-semibold text-ink">Reports</h1>
          <p className="text-sm text-ink2 mt-0.5">AI-generated performance reports with actionable narratives</p>
        </div>
        <div className="flex items-center gap-2">
          {products.length > 1 && products.map(p => (
            <button
              key={p.id}
              onClick={() => setSelected(p.id)}
              className={`text-xs rounded-[6px] px-3 py-1.5 border font-medium transition-colors ${
                selected === p.id
                  ? 'bg-[--sage-d] border-[--sage-b] text-sage'
                  : 'bg-surface border-[--border2] text-ink2 hover:bg-raised'
              }`}
            >
              {p.name}
            </button>
          ))}
          <button
            onClick={() => setShowGenForm(!showGenForm)}
            className="flex items-center gap-1.5 text-sm bg-sage text-white rounded-[6px] px-4 py-2 font-medium"
          >
            <IconSparkles size={15} />Generate
            {showGenForm ? <IconChevronUp size={13} /> : <IconChevronDown size={13} />}
          </button>
        </div>
      </div>

      {/* Generate form */}
      {showGenForm && (
        <div className="bg-surface border border-[--sage-b] rounded-[10px] p-4 mb-6">
          <div className="text-sm font-semibold text-ink mb-3">New Report</div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <div className="text-xs text-ink2 mb-1.5">Type</div>
              <select
                value={genType}
                onChange={e => setGenType(e.target.value as ReportType)}
                className="w-full bg-raised border border-[--border2] rounded-[6px] px-3 py-2 text-sm text-ink"
              >
                {REPORT_TYPES.map(t => (
                  <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                ))}
              </select>
            </div>
            <div>
              <div className="text-xs text-ink2 mb-1.5">Period Start</div>
              <input
                type="date"
                value={genPeriodStart}
                onChange={e => setGenPeriodStart(e.target.value)}
                className="w-full bg-raised border border-[--border2] rounded-[6px] px-3 py-2 text-sm text-ink"
              />
            </div>
            <div>
              <div className="text-xs text-ink2 mb-1.5">Period End</div>
              <input
                type="date"
                value={genPeriodEnd}
                onChange={e => setGenPeriodEnd(e.target.value)}
                className="w-full bg-raised border border-[--border2] rounded-[6px] px-3 py-2 text-sm text-ink"
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="w-full bg-sage text-white rounded-[6px] px-4 py-2 text-sm font-medium"
              >
                {generating ? 'Generating…' : 'Generate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reports grid */}
      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="text-sm text-ink3">Loading reports…</div>
        </div>
      ) : reports.length === 0 ? (
        <div className="bg-surface border border-[--border] rounded-[10px] p-10 text-center">
          <IconFileAnalytics size={32} className="text-ink3 mx-auto mb-3" />
          <div className="text-sm font-medium text-ink mb-1">No reports yet</div>
          <div className="text-xs text-ink2">Generate your first report to get an AI narrative of your campaign performance.</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {reports.map(r => (
            <ReportCard key={r.id} report={r} onSelect={setActiveReport} />
          ))}
        </div>
      )}

      {/* Report drawer */}
      {activeReport && token && (
        <ReportDrawer report={activeReport} token={token} onClose={() => setActiveReport(null)} />
      )}
    </div>
  );
}
