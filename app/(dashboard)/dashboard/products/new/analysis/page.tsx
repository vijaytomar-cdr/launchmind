'use client';
/**
 * @file analysis/page.tsx — Step 3: Live analysis progress
 * @description Polls GET /products/scrape/:jobId every 2 seconds.
 *   Shows each step completing in real time — not just a spinner.
 *   Auto-navigates to Step 4 when status === 'completed' | 'complete'.
 *   Shows error state with retry if status === 'failed'.
 * @security jobId and productId read from sessionStorage. Server verifies ownership.
 * @dependencies lib/api, lib/types/intake, next/navigation
 */

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { api } from '@/lib/api';
import { IntakeSteps } from '@/components/launchmind/IntakeSteps';
import { INTAKE_STORAGE, type ScrapeJobStatus } from '@/lib/types/intake';

interface ProgressItem {
  label: string;
  sub: string;
  doneAt: ScrapeJobStatus['status'][];
  runAt: ScrapeJobStatus['status'][];
  showIfWebsite?: boolean;
}

const PROGRESS_ITEMS: ProgressItem[] = [
  {
    label: 'App Store / Play Store metadata',
    sub: 'Reading name, category, rating, screenshots…',
    doneAt: ['scraping_app_store', 'scraping_website', 'analysing_reviews', 'finding_competitors', 'matching_playbook', 'building_icp', 'complete', 'completed'],
    runAt: ['scraping_play_store', 'scraping_app_store', 'queued', 'active', 'waiting'],
  },
  {
    label: 'Reviews analysed',
    sub: 'Finding pain points and copy signals…',
    doneAt: ['finding_competitors', 'matching_playbook', 'building_icp', 'complete', 'completed'],
    runAt: ['analysing_reviews'],
  },
  {
    label: 'Finding competitors',
    sub: 'Searching App Store + Play Store for similar apps…',
    doneAt: ['matching_playbook', 'building_icp', 'complete', 'completed'],
    runAt: ['finding_competitors'],
  },
  {
    label: 'Scanning your website',
    sub: 'Adding SEO + testimonial signals…',
    doneAt: ['building_icp', 'complete', 'completed'],
    runAt: ['scraping_website', 'matching_playbook'],
    showIfWebsite: true,
  },
  {
    label: 'Matching playbook signals',
    sub: 'Comparing against similar app campaigns…',
    doneAt: ['building_icp', 'complete', 'completed'],
    runAt: ['matching_playbook'],
  },
  {
    label: 'Building founder-specific plan',
    sub: 'Applying your budget, MOAT, and channel preferences…',
    doneAt: ['complete', 'completed'],
    runAt: ['building_icp'],
  },
];

function getItemState(item: ProgressItem, status: ScrapeJobStatus['status']): 'done' | 'active' | 'pending' {
  if (item.doneAt.includes(status)) return 'done';
  if (item.runAt.includes(status)) return 'active';
  return 'pending';
}

export default function AnalysisPage() {
  const router = useRouter();
  const supabase = createClient();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [token, setToken]     = useState('');
  const [jobId, setJobId]     = useState('');
  const [appName, setAppName] = useState('your app');
  const [hasWebsite, setHasWebsite] = useState(false);
  const [status, setStatus]   = useState<ScrapeJobStatus['status']>('queued');
  const [failed, setFailed]   = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.access_token) setToken(data.session.access_token);
    });

    const jid = sessionStorage.getItem(INTAKE_STORAGE.jobId);
    if (!jid) { router.replace('/dashboard/products/new'); return; }
    setJobId(jid);

    const urlsRaw = sessionStorage.getItem(INTAKE_STORAGE.urls);
    if (urlsRaw) {
      try {
        const urls = JSON.parse(urlsRaw);
        if (urls.websiteUrl) setHasWebsite(true);
        const storeUrl = urls.appStoreUrl || urls.playStoreUrl || '';
        const match = storeUrl.match(/\/([^/]+)\/id\d+/) || storeUrl.match(/\?id=([^&]+)/);
        if (match) setAppName(match[1].replace(/[.-]/g, ' ').trim());
      } catch { /* ignore */ }
    }
  }, [router]);

  useEffect(() => {
    if (!jobId || !token) return;

    intervalRef.current = setInterval(async () => {
      try {
        const result = await api.products.pollScrapeJob(jobId, token);
        setStatus(result.status);

        if (result.status === 'completed' || result.status === 'complete') {
          clearInterval(intervalRef.current!);
          // Store scrape result for later steps
          if (result.result) {
            sessionStorage.setItem(INTAKE_STORAGE.scrapeResult, JSON.stringify(result.result));
          }
          router.push('/dashboard/products/new/icp');
        }

        if (result.status === 'failed') {
          clearInterval(intervalRef.current!);
          setFailed(result.error ?? 'Analysis failed — please retry');
        }
      } catch { /* polling transient error — keep trying */ }
    }, 2000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [jobId, token, router]);

  if (failed) {
    return (
      <div>
        <IntakeSteps currentStep="analysing" />
        <div
          className="rounded-[10px] p-6 text-center"
          style={{ background: 'var(--surface)', border: '1px solid var(--red-b)' }}
        >
          <p className="font-semibold mb-2" style={{ fontSize: 15, color: 'var(--red)' }}>
            Analysis failed
          </p>
          <p style={{ fontSize: 13, color: 'var(--ink2)', marginBottom: 16 }}>{failed}</p>
          <button
            onClick={() => router.push('/dashboard/products/new')}
            className="rounded-[6px] px-4 py-2 font-medium hover:opacity-90 transition-opacity"
            style={{ background: 'var(--sage)', color: '#fff', fontSize: 13 }}
          >
            Try again →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <IntakeSteps currentStep="analysing" />

      <div className="mb-6">
        <h1 className="font-display font-bold mb-1" style={{ fontSize: 22, color: 'var(--ink)' }}>
          Analysing {appName}
        </h1>
        <p style={{ fontSize: 13, color: 'var(--ink2)' }}>
          Reading your app, reviews, and founder context. About 30 seconds.
        </p>
      </div>

      <div
        className="rounded-[10px] p-6 space-y-4"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        {PROGRESS_ITEMS.filter((item) => !item.showIfWebsite || hasWebsite).map((item) => {
          const state = getItemState(item, status);
          return (
            <div key={item.label} className="flex items-start gap-4">
              {/* Icon */}
              <div style={{ width: 24, height: 24, flexShrink: 0, marginTop: 2 }}>
                {state === 'done' && (
                  <div
                    className="flex items-center justify-center rounded-full"
                    style={{ width: 24, height: 24, background: 'var(--sage)' }}
                  >
                    <svg width="11" height="11" fill="none" stroke="#fff" strokeWidth="2.5" viewBox="0 0 12 12">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2 6l3 3 5-5" />
                    </svg>
                  </div>
                )}
                {state === 'active' && (
                  <div
                    className="rounded-full border-2 border-t-transparent animate-spin"
                    style={{ width: 24, height: 24, borderColor: 'var(--indigo)', borderTopColor: 'transparent' }}
                  />
                )}
                {state === 'pending' && (
                  <div
                    className="flex items-center justify-center rounded-full"
                    style={{ width: 24, height: 24, background: 'var(--raised)', border: '1px solid var(--border2)' }}
                  >
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ink3)' }} />
                  </div>
                )}
              </div>
              {/* Text */}
              <div>
                <p
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: state === 'pending' ? 'var(--ink3)' : 'var(--ink)',
                  }}
                >
                  {item.label}
                </p>
                <p style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 2 }}>
                  {item.sub}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
