import type { BriefResponse } from '@/lib/api';
import { ALLIGNX_MORNING_BRIEF_DEMO } from './demoFixture';

export type MorningBriefPerformanceSource = 'REAL' | 'DEMO' | 'UNAVAILABLE';

export interface MorningBriefMetric {
  key: string;
  label: string;
  value: number;
  previousValue: number | null;
  unit: 'count' | 'percent' | 'currency';
  deltaKind: 'percent-change' | 'point-change' | 'absolute-change' | null;
  freshness: string | null;
  source: MorningBriefPerformanceSource;
  watchStatus: string | null;
}

export interface MorningBriefViewModel {
  performanceSource: MorningBriefPerformanceSource;
  goal: {
    metric: string;
    target: number;
    actual: number | null;
    progress: number | null;
    remaining: number | null;
    /** Null until the read model supplies a governed period clock. */
    daysRemaining: number | null;
    /** Null until actual progress can be compared with time elapsed. */
    pace: { status: 'AHEAD' | 'ON_PACE' | 'BEHIND'; delta: number | null } | null;
  } | null;
  metrics: MorningBriefMetric[];
  activity: {
    marketSignals: number;
    creativesPrepared: number;
    decisionsWaiting: number;
    creativesNeedingReview: number;
    additionalOpportunities: number;
  } | null;
  activityTimeline: Array<{
    id: string;
    timeLabel: string;
    category: 'PERFORMANCE' | 'MARKET' | 'DIRECTION' | 'CREATIVE' | 'OWNER';
    summary: string;
  }>;
  /** Null until a governed recommendation supplies its measurement plan. */
  priorityLoop: {
    watchingOutcome: string;
    nextReview: string;
    learningQuestion: string;
  } | null;
  interpretation: { summary: string; judgment: string | null; basis: string | null };
  lastExperiment: {
    name: string;
    metric: string;
    delta: number;
    summary: string;
    learned: string | null;
    connectionToPriority: string | null;
  } | null;
  changeSummary: string | null;
  noActionNeeded: { area: string; summary: string } | null;
  freshness: string | null;
}

function realViewModel(data: BriefResponse): MorningBriefViewModel {
  const founderGoal = data.phase1?.primaryGoal ?? null;
  const freshness = data.metrics.performanceAsOf
    ? `Reporting week of ${new Date(`${data.metrics.performanceAsOf}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
    : null;
  const metrics: MorningBriefMetric[] = [];
  if (data.metrics.weeklyInstalls != null) {
    metrics.push({
      key: 'installs', label: 'Installs', value: data.metrics.weeklyInstalls,
      previousValue: null, unit: 'count', deltaKind: null, freshness, source: 'REAL', watchStatus: null,
    });
  }
  if (data.metrics.cpi != null) {
    metrics.push({
      key: 'acquisition-cost', label: 'Acquisition cost', value: data.metrics.cpi,
      previousValue: null, unit: 'currency', deltaKind: null, freshness, source: 'REAL', watchStatus: null,
    });
  }
  const trend = data.metrics.weekOverWeekInstallDelta;
  return {
    performanceSource: 'REAL',
    goal: founderGoal ? {
      metric: founderGoal.unit, target: founderGoal.target,
      actual: null, progress: null, remaining: null, daysRemaining: null, pace: null,
    } : null,
    metrics,
    activity: null,
    activityTimeline: [],
    priorityLoop: null,
    interpretation: {
      summary: trend != null
        ? `Installs ${trend >= 0 ? 'increased' : 'decreased'} ${Math.abs(trend)}% from the previous measured week.`
        : 'LaunchMind can observe acquisition performance; more history is needed for a trend.',
      judgment: null,
      basis: 'Observed performance data',
    },
    lastExperiment: null,
    changeSummary: null,
    noActionNeeded: null,
    freshness,
  };
}

function demoViewModel(): MorningBriefViewModel {
  const fixture = ALLIGNX_MORNING_BRIEF_DEMO;
  const progress = fixture.goal.actual / fixture.goal.target * 100;
  const daysRemaining = Math.max(0, fixture.goal.period.totalDays - fixture.goal.period.daysElapsed);
  const expectedByNow = fixture.goal.target * fixture.goal.period.daysElapsed / fixture.goal.period.totalDays;
  const paceDelta = Math.round(Math.abs(fixture.goal.actual - expectedByNow));
  const paceStatus = Math.abs(fixture.goal.actual - expectedByNow) < 0.5
    ? 'ON_PACE' as const
    : fixture.goal.actual > expectedByNow ? 'AHEAD' as const : 'BEHIND' as const;
  return {
    performanceSource: 'DEMO',
    goal: {
      metric: fixture.goal.metric,
      target: fixture.goal.target,
      actual: fixture.goal.actual,
      progress,
      remaining: Math.max(0, fixture.goal.target - fixture.goal.actual),
      daysRemaining,
      pace: { status: paceStatus, delta: paceStatus === 'ON_PACE' ? null : paceDelta },
    },
    metrics: [
      { key: 'requests', label: 'Requests', value: fixture.metrics.serviceRequests.current, previousValue: fixture.metrics.serviceRequests.previous, unit: 'count', deltaKind: 'percent-change', freshness: fixture.freshness, source: 'DEMO', watchStatus: null },
      { key: 'conversion', label: 'Request → booking', value: fixture.metrics.requestToBookingConversion.current, previousValue: fixture.metrics.requestToBookingConversion.previous, unit: 'percent', deltaKind: 'point-change', freshness: fixture.freshness, source: 'DEMO', watchStatus: fixture.watchThresholds.requestToBookingConversion.label },
      { key: 'cost-per-booking', label: 'Cost / booking', value: fixture.metrics.costPerBooking.current, previousValue: fixture.metrics.costPerBooking.previous, unit: 'currency', deltaKind: 'absolute-change', freshness: fixture.freshness, source: 'DEMO', watchStatus: fixture.watchThresholds.costPerBooking.label },
      { key: 'installs', label: 'Installs', value: fixture.metrics.installs.current, previousValue: fixture.metrics.installs.previous, unit: 'count', deltaKind: 'percent-change', freshness: fixture.freshness, source: 'DEMO', watchStatus: null },
    ],
    activity: fixture.activity,
    activityTimeline: fixture.activityTimeline.map(event => ({ ...event })),
    priorityLoop: fixture.priorityLoop,
    interpretation: fixture.interpretation,
    lastExperiment: fixture.lastExperiment,
    changeSummary: fixture.changeSummary,
    noActionNeeded: fixture.noActionNeeded,
    freshness: fixture.freshness,
  };
}

function unavailableViewModel(data: BriefResponse): MorningBriefViewModel {
  const founderGoal = data.phase1?.primaryGoal ?? null;
  return {
    performanceSource: 'UNAVAILABLE',
    goal: founderGoal ? {
      metric: founderGoal.unit, target: founderGoal.target,
      actual: null, progress: null, remaining: null, daysRemaining: null, pace: null,
    } : null,
    metrics: [],
    activity: null,
    activityTimeline: [],
    priorityLoop: null,
    interpretation: {
      summary: 'Performance is not measured yet. Today’s recommendation is based on founder context and product understanding.',
      judgment: null,
      basis: null,
    },
    lastExperiment: null,
    changeSummary: null,
    noActionNeeded: null,
    freshness: null,
  };
}

/**
 * The sole performance-source selector for Morning Brief.
 * Replacement path: provider-backed values enter BriefResponse.metrics and take
 * the REAL branch; the UI and its components do not change.
 */
export function createMorningBriefViewModel(
  data: BriefResponse,
  options: { demoRequested: boolean; runtime: 'development' | 'test' | 'production' },
): MorningBriefViewModel {
  if (data.metrics.performanceDataAvailable) return realViewModel(data);
  if (options.runtime !== 'production' && options.demoRequested) return demoViewModel();
  return unavailableViewModel(data);
}
