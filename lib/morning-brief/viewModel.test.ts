import { describe, expect, it } from 'vitest';
import type { BriefResponse } from '@/lib/api';
import { createMorningBriefViewModel } from './viewModel';

const brief = (performanceDataAvailable: boolean): BriefResponse => ({
  founder: { name: 'Vijay', plan: 'free' },
  product: { id: 'p1', name: 'AllignX', platform: 'ios' },
  recommendation: null,
  pendingApprovals: { total: 0, items: [] },
  opportunities: [], recentTimeline: [],
  growthBrain: { hasStrategy: true, confidence: null, lastUpdated: null },
  metrics: {
    weeklyInstalls: performanceDataAvailable ? 9 : null,
    cpi: performanceDataAvailable ? 4 : null,
    activeCampaigns: null, weekOverWeekInstallDelta: null,
    performanceDataAvailable, performanceAsOf: null,
  },
  memories: [], phase1: {
    direction: null, audience: null, contextDelta: null, workingStyle: null,
    primaryGoal: { type: 'custom', target: 20, unit: 'bookings / month', horizonDays: 90 },
  },
});

describe('Morning Brief performance view model', () => {
  it('always gives real data precedence over requested demo data', () => {
    expect(createMorningBriefViewModel(brief(true), { demoRequested: true, runtime: 'development' }).performanceSource).toBe('REAL');
  });

  it('uses centralized demo data only when explicitly requested outside production', () => {
    const vm = createMorningBriefViewModel(brief(false), { demoRequested: true, runtime: 'development' });
    expect(vm.performanceSource).toBe('DEMO');
    expect(vm.goal).toMatchObject({ actual: 8, target: 20, progress: 40, remaining: 12, daysRemaining: 14, pace: { status: 'BEHIND', delta: 3 } });
    expect(vm.metrics).toHaveLength(4);
  });

  it('refuses demo data in production even when requested', () => {
    expect(createMorningBriefViewModel(brief(false), { demoRequested: true, runtime: 'production' }).performanceSource).toBe('UNAVAILABLE');
  });

  it('defaults to the honest unavailable state', () => {
    expect(createMorningBriefViewModel(brief(false), { demoRequested: false, runtime: 'development' }).performanceSource).toBe('UNAVAILABLE');
  });
});
