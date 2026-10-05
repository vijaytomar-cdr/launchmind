/**
 * Development-only Morning Brief performance fixture.
 *
 * This module is presentation input only. It is never sent to an API, persisted,
 * used as evidence, or supplied to Growth Brain / Marketing Memory reasoning.
 */
export const ALLIGNX_MORNING_BRIEF_DEMO = Object.freeze({
  goal: {
    metric: 'bookings',
    target: 20,
    actual: 8,
    period: { daysElapsed: 16, totalDays: 30 },
  },
  metrics: {
    bookings: { current: 8, previous: 6 },
    serviceRequests: { current: 31, previous: 27 },
    requestToBookingConversion: { current: 25.8, previous: 29.6 },
    costPerBooking: { current: 42, previous: 36 },
    installs: { current: 132, previous: 111 },
    activeCampaigns: 2,
  },
  watchThresholds: {
    requestToBookingConversion: { kind: 'minimum', value: 30, label: 'Below 30% target' },
    costPerBooking: { kind: 'maximum', value: 45, label: 'Approaching $45 guardrail' },
  },
  activity: {
    marketSignals: 1,
    creativesPrepared: 3,
    decisionsWaiting: 1,
    creativesNeedingReview: 1,
    additionalOpportunities: 2,
  },
  activityTimeline: [
    { id: 'conversion-below-target', timeLabel: '9:42 AM', category: 'PERFORMANCE', summary: 'Conversion moved below target.' },
    { id: 'market-signal-reviewed', timeLabel: '10:18 AM', category: 'MARKET', summary: 'LaunchMind evaluated a new market signal.' },
    { id: 'direction-retained', timeLabel: '10:19 AM', category: 'DIRECTION', summary: 'Current direction retained. The signal was not strong enough to override current performance evidence.' },
    { id: 'creative-prepared', timeLabel: '11:04 AM', category: 'CREATIVE', summary: '3 creative concepts prepared.' },
    { id: 'owner-review', timeLabel: 'Now', category: 'OWNER', summary: '1 item needs your review.' },
  ],
  priorityLoop: {
    watchingOutcome: 'Request → booking conversion',
    nextReview: 'After 25 additional requests · est. 2 days',
    learningQuestion: 'Whether preferred availability improves request-to-booking conversion.',
  },
  interpretation: {
    summary: 'Demand is increasing, but conversion is weakening and acquisition is becoming more expensive.',
    judgment: 'Fix conversion before increasing acquisition.',
    basis: 'Seeded development snapshot',
  },
  lastExperiment: {
    name: 'Simplified request form',
    metric: 'Request completion',
    delta: 8,
    summary: 'Completion improved after the form change.',
    learned: 'Reducing request friction was associated with better completion.',
    connectionToPriority: 'Request simplification improved completion. LaunchMind recommends testing the next friction point: post-request availability.',
  },
  changeSummary: 'No evidence was strong enough to change today’s priority.',
  noActionNeeded: {
    area: 'Acquisition volume',
    summary: 'Installs increased 18.9%; no intervention recommended today.',
  },
  freshness: 'Seeded development snapshot',
} as const);

export type MorningBriefDemoFixture = typeof ALLIGNX_MORNING_BRIEF_DEMO;
