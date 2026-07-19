/**
 * @file benchmarks.route.ts
 * @description Intelligence Network benchmark and trend APIs.
 *   Returns anonymous, category-level benchmarks and trend summaries.
 *   Any authenticated founder can access benchmarks — no plan gate.
 * @security JWT required. No founder-specific data returned.
 *   Benchmarks are aggregate-only (category × market level).
 *   checkBenchmarkAccess enforces Decision Engine access control.
 * @dependencies supabaseAdmin, intelligenceNetworkService, decisionEngineService
 */

import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import * as Sentry from '@sentry/node';
import { getSupabaseAdmin } from '../lib/supabaseAdmin';
import { getBenchmarks, getTrends } from '../services/intelligenceNetworkService';
import { checkBenchmarkAccess } from '../services/decisionEngineService';

async function benchmarksPlugin(server: FastifyInstance): Promise<void> {

  /**
   * GET /benchmarks
   * Returns benchmark aggregates for a category+market combination.
   * Optionally filtered by channel.
   * ?category= (required)  ?market= (required)  ?channel= (optional)
   * Any authenticated founder can read benchmarks (ADR-053).
   */
  server.get('/benchmarks', async (request, reply) => {
    await request.jwtVerify();
    const founderId = (request.user as { sub: string }).sub;
    const { category, market, channel } = request.query as {
      category?: string; market?: string; channel?: string;
    };

    if (!category || !market) {
      return reply.status(400).send({ error: 'category and market are required' });
    }

    // Decision Engine: benchmark access check (currently open to all authenticated founders)
    checkBenchmarkAccess(founderId);

    const benchmark = await getBenchmarks(category, market, channel);

    if (!benchmark) {
      return reply.send({
        benchmark: null,
        message: 'Insufficient signals for this category+market combination (minimum 3 required)',
      });
    }

    return reply.send({ benchmark });
  });

  /**
   * GET /benchmarks/categories
   * Returns all distinct categories that have benchmark data.
   * Useful for populating UI dropdowns.
   */
  server.get('/benchmarks/categories', async (request, reply) => {
    await request.jwtVerify();
    const founderId = (request.user as { sub: string }).sub;
    checkBenchmarkAccess(founderId);

    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from('playbook_signals')
      .select('category, market')
      .order('category');

    if (error) {
      Sentry.captureException(error, { tags: { route: 'GET /benchmarks/categories' } });
      return reply.status(500).send({ error: 'Failed to fetch categories' });
    }

    // Deduplicate and count
    const countMap: Record<string, { category: string; market: string; count: number }> = {};
    for (const row of (data ?? []) as { category: string; market: string }[]) {
      const key = `${row.category}:${row.market}`;
      if (!countMap[key]) countMap[key] = { category: row.category, market: row.market, count: 0 };
      countMap[key].count++;
    }

    // Only return categories with ≥3 signals (cohort minimum)
    const categories = Object.values(countMap).filter(c => c.count >= 3);

    return reply.send({ categories });
  });

  /**
   * GET /benchmarks/trends
   * Returns pre-computed trend summaries for a category+market.
   * ?category= (required)  ?market= (required)  ?period=30|90 (optional, default 30)
   */
  server.get('/benchmarks/trends', async (request, reply) => {
    await request.jwtVerify();
    const founderId = (request.user as { sub: string }).sub;
    const { category, market, period } = request.query as {
      category?: string; market?: string; period?: string;
    };

    if (!category || !market) {
      return reply.status(400).send({ error: 'category and market are required' });
    }

    checkBenchmarkAccess(founderId);

    const periodDays = period === '90' ? 90 : 30;
    const trends = await getTrends(category, market, periodDays);

    return reply.send({ trends, category, market, periodDays });
  });

  /**
   * GET /benchmarks/summary
   * Returns a high-level intelligence summary for the founder's products.
   * Cross-references the founder's product categories with available benchmarks.
   */
  server.get('/benchmarks/summary', async (request, reply) => {
    await request.jwtVerify();
    const founderId = (request.user as { sub: string }).sub;
    checkBenchmarkAccess(founderId);

    const supabase = getSupabaseAdmin();

    // Get the founder's products to identify relevant categories
    const { data: products } = await supabase
      .from('products')
      .select('id, name, category, markets')
      .eq('founder_id', founderId)
      .is('deleted_at', null)
      .limit(10);

    if (!products || products.length === 0) {
      return reply.send({ summaries: [], message: 'No products found' });
    }

    // Fetch benchmarks for each unique category+market combination
    const summaries: Array<{
      productName: string;
      category: string;
      market: string;
      benchmark: Awaited<ReturnType<typeof getBenchmarks>>;
      trends: Awaited<ReturnType<typeof getTrends>>;
    }> = [];

    for (const product of products as { id: string; name: string; category: string | null; markets: string[] | null }[]) {
      if (!product.category) continue;
      const markets = product.markets ?? ['usa'];

      for (const market of markets) {
        const [benchmark, trends] = await Promise.all([
          getBenchmarks(product.category, market),
          getTrends(product.category, market, 30),
        ]);

        summaries.push({
          productName: product.name,
          category:    product.category,
          market,
          benchmark,
          trends,
        });
      }
    }

    return reply.send({ summaries });
  });
}

export const benchmarksRoutes = fp(benchmarksPlugin);
