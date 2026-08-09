/**
 * @file FeedbackWidget.tsx
 * @description Floating "Rate this" pill fixed at the bottom-right of all dashboard pages.
 *   Clicking opens an inline modal: 1-5 star rating + optional text area + submit.
 *   On success, fires the feedback_submitted onboarding event and closes after 2 s.
 * @security Uses Supabase session token for the API call. No PII in analytics event.
 * @dependencies lib/api, lib/analytics, lib/supabase/client
 */

'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { api, ApiError } from '@/lib/api';
import { trackOnboarding } from '@/lib/analytics';

const STAR_COUNT = 5;

export function FeedbackWidget() {
  const supabase = createClient();

  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  function handleOpen() {
    setOpen(true);
    setRating(0);
    setHovered(0);
    setBody('');
    setSuccess(false);
    setError('');
  }

  function handleClose() {
    setOpen(false);
  }

  async function handleSubmit() {
    if (rating === 0) {
      setError('Please select a rating');
      return;
    }
    setError('');
    setSubmitting(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Not authenticated');

      await api.feedback.submit(
        { rating, body: body.trim() || undefined, context: 'general' },
        session.access_token
      );

      trackOnboarding('feedback_submitted');
      setSuccess(true);
      setTimeout(() => {
        setOpen(false);
        setSuccess(false);
      }, 2000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Submission failed — please retry');
    } finally {
      setSubmitting(false);
    }
  }

  const displayRating = hovered || rating;

  return (
    <>
      {/* Floating pill trigger */}
      <button
        onClick={handleOpen}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full px-4 py-2.5 font-medium shadow-lg transition-opacity hover:opacity-90"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border2)',
          color: 'var(--ink2)',
          fontSize: 13,
          boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
        }}
        aria-label="Give feedback"
      >
        <span>⭐</span>
        <span>Rate this</span>
        <span style={{ color: 'var(--ink3)' }}>→</span>
      </button>

      {/* Backdrop + modal */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-end"
          style={{ pointerEvents: 'none' }}
        >
          {/* Clickable backdrop */}
          <div
            className="absolute inset-0"
            style={{ background: 'rgba(27,31,46,0.18)', pointerEvents: 'auto' }}
            onClick={handleClose}
            aria-hidden="true"
          />

          {/* Modal card */}
          <div
            className="relative m-6 rounded-[12px] w-80"
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border2)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.14)',
              pointerEvents: 'auto',
            }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-5 py-4"
              style={{ borderBottom: '1px solid var(--border)' }}
            >
              <p className="font-display font-semibold" style={{ fontSize: 14, color: 'var(--ink)' }}>
                How&apos;s it going?
              </p>
              <button
                onClick={handleClose}
                className="transition-opacity hover:opacity-70"
                style={{ color: 'var(--ink3)', fontSize: 18, lineHeight: 1 }}
                aria-label="Close feedback"
              >
                ×
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-4 space-y-4">
              {success ? (
                <div className="text-center py-4">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center mx-auto mb-3"
                    style={{ background: 'var(--sage-d)', border: '1px solid var(--sage-b)' }}
                  >
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" style={{ color: 'var(--sage)' }}>
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <p className="font-semibold" style={{ fontSize: 14, color: 'var(--ink)' }}>Thanks for your feedback!</p>
                  <p style={{ fontSize: 13, color: 'var(--ink2)', marginTop: 4 }}>It helps us improve LaunchMind.</p>
                </div>
              ) : (
                <>
                  {/* Star selector */}
                  <div>
                    <p style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: 8 }}>
                      Rate your experience
                    </p>
                    <div className="flex gap-1">
                      {Array.from({ length: STAR_COUNT }, (_, i) => {
                        const val = i + 1;
                        const filled = val <= displayRating;
                        return (
                          <button
                            key={val}
                            onClick={() => setRating(val)}
                            onMouseEnter={() => setHovered(val)}
                            onMouseLeave={() => setHovered(0)}
                            aria-label={`${val} star${val !== 1 ? 's' : ''}`}
                            style={{
                              fontSize: 26,
                              color: filled ? 'var(--amber)' : 'var(--border2)',
                              lineHeight: 1,
                              transition: 'color 0.1s',
                            }}
                          >
                            ★
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Text area */}
                  <div>
                    <label
                      htmlFor="feedback-body"
                      style={{ fontSize: 12, color: 'var(--ink2)', display: 'block', marginBottom: 6 }}
                    >
                      Tell us more <span style={{ color: 'var(--ink3)' }}>(optional)</span>
                    </label>
                    <textarea
                      id="feedback-body"
                      rows={3}
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      placeholder="What's working? What could be better?"
                      className="w-full rounded-[6px] px-3 py-2 outline-none resize-none"
                      style={{
                        background: 'var(--raised)',
                        border: '1px solid var(--border2)',
                        color: 'var(--ink)',
                        fontSize: 13,
                      }}
                    />
                  </div>

                  {error && (
                    <p style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</p>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={handleClose}
                      className="flex-1 rounded-[6px] px-4 py-2 transition-opacity hover:opacity-80"
                      style={{
                        fontSize: 13,
                        color: 'var(--ink2)',
                        border: '1px solid var(--border2)',
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSubmit}
                      disabled={submitting || rating === 0}
                      className="flex-1 rounded-[6px] px-4 py-2 font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-opacity hover:opacity-90"
                      style={{
                        background: 'var(--sage)',
                        color: '#fff',
                        fontSize: 13,
                      }}
                    >
                      {submitting ? 'Sending…' : 'Send feedback'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
