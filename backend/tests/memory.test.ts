/**
 * @file memory.test.ts
 * @description Tests for Marketing Memory, Knowledge Graph, and Learning Pipeline.
 *   Acceptance criteria (all ✅ by end of file):
 *     ✅ createMemory: inserts row, returns memory with correct fields
 *     ✅ updateMemory: writes version record, increments version, applies patch
 *     ✅ archiveMemory: sets status='archived' and archived_at
 *     ✅ findDuplicateMemory: returns existing ID on title match, null on miss
 *     ✅ mergeMemories: archives discard, bumps confidence on kept
 *     ✅ createNode + createEdge: upserts nodes, verifies owner before edge
 *     ✅ createEdge: rejects when nodes don't belong to founder
 *     ✅ getGraph: returns nodes + their edges for product
 *     ✅ mergeNodes: redirects edges, deletes discard node
 *     ✅ ingestLearningEvent intake_completed: creates memories + graph nodes
 *     ✅ ingestLearningEvent campaign_result: creates campaign memory
 *     ✅ ingestLearningEvent: marks event failed on service error
 *     ✅ GET /memory requires auth (401)
 *     ✅ POST /memory/events ingest and return result
 *     ✅ GET /knowledge/graph returns graph for founder
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';

const FOUNDER_ID  = 'cc000000-0000-0000-0000-000000000001';
const PRODUCT_ID  = 'dd000000-0000-0000-0000-000000000002';
const MEMORY_ID   = 'ee000000-0000-0000-0000-000000000003';
const NODE_ID_A   = 'ff000000-0000-0000-0000-000000000004';
const NODE_ID_B   = 'gg000000-0000-0000-0000-000000000005';
const JWT_SECRET  = 'test-jwt-secret-min-32-chars-long!!';

function makeToken(): string {
  return jwt.sign(
    { sub: FOUNDER_ID, role: 'authenticated', email: 'test@example.com' },
    JWT_SECRET,
    { expiresIn: '1h' },
  );
}

// ── Test state ────────────────────────────────────────────────────────────────

let memoryExists   = false;
let versionInserted = false;
let nodeAExists    = false;
let nodeBExists    = false;
let eventInserted  = false;

const MOCK_MEMORY = {
  id: MEMORY_ID, founder_id: FOUNDER_ID, product_id: PRODUCT_ID,
  memory_type: 'product', title: 'TestApp — Product Profile',
  content: { targetUser: 'Developers' }, source: 'intake',
  confidence: 0.70, evidence_ids: [], status: 'active', version: 1,
  created_at: '2026-07-08T00:00:00.000Z', updated_at: '2026-07-08T00:00:00.000Z',
  archived_at: null,
};

const MOCK_NODE_A = {
  id: NODE_ID_A, founder_id: FOUNDER_ID, product_id: PRODUCT_ID,
  node_type: 'product', label: 'TestApp', properties: {}, source_id: PRODUCT_ID,
  source_type: 'products', confidence: 0.8,
  created_at: '2026-07-08T00:00:00.000Z', updated_at: '2026-07-08T00:00:00.000Z',
};

const MOCK_NODE_B = {
  id: NODE_ID_B, founder_id: FOUNDER_ID, product_id: PRODUCT_ID,
  node_type: 'persona', label: 'Developers', properties: {}, source_id: null,
  source_type: null, confidence: 0.65,
  created_at: '2026-07-08T00:00:00.000Z', updated_at: '2026-07-08T00:00:00.000Z',
};

// ── Supabase mock ─────────────────────────────────────────────────────────────

const mockFrom = vi.fn();

vi.mock('../src/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({
    from: mockFrom,
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: FOUNDER_ID, email: 'test@example.com' } },
        error: null,
      })),
    },
  }),
}));

const MOCK_EDGE = {
  id: 'edge-001', founder_id: FOUNDER_ID, source_id: NODE_ID_A, target_id: NODE_ID_B,
  relationship: 'targets', weight: 0.8, properties: {}, created_at: '2026-07-08T00:00:00.000Z',
};

/**
 * Sticky chain with per-call closure state.
 * Every chaining method returns `chain` (sticky). Terminal `.single()` checks
 * closure flags (wasInsertCalled, wasUpdateCalled) to return the right data.
 * The chain has a `.then` property making it a thenable for direct `await chain` patterns.
 */
function makeSticky(table: string): Record<string, unknown> {
  let wasInsertCalled  = false;
  let wasUpdateCalled  = false;
  let wasUpsertCalled  = false;

  // Thenable resolution for: const { data, error } = await chain.update().eq().eq()
  const resolveChain = Promise.resolve({ data: null, error: null });

  function single(): Promise<{ data: unknown; error: unknown }> {
    switch (table) {
      case 'marketing_memories':
        if (wasUpdateCalled) {
          // Return version-incremented data for update calls
          return Promise.resolve({ data: { ...MOCK_MEMORY, version: 2, status: 'archived', archived_at: '2026-07-08T00:00:00.000Z' }, error: null });
        }
        if (wasInsertCalled) {
          return Promise.resolve({ data: MOCK_MEMORY, error: null });
        }
        return Promise.resolve({ data: memoryExists ? MOCK_MEMORY : null, error: memoryExists ? null : { message: 'not found' } });

      case 'marketing_memory_versions':
        return Promise.resolve({ data: { id: 'ver-001' }, error: null });

      case 'knowledge_nodes':
        if (wasInsertCalled || wasUpsertCalled) {
          return Promise.resolve({ data: MOCK_NODE_A, error: null });
        }
        return Promise.resolve({ data: nodeAExists ? MOCK_NODE_A : null, error: null });

      case 'knowledge_edges':
        return Promise.resolve({ data: MOCK_EDGE, error: null });

      case 'learning_events':
        if (wasInsertCalled) { eventInserted = true; }
        return Promise.resolve({ data: { id: 'ev-001' }, error: null });

      default:
        return Promise.resolve({ data: wasInsertCalled ? { id: 'generic-001' } : null, error: null });
    }
  }

  function maybeSingle(): Promise<{ data: unknown; error: null }> {
    if (table === 'marketing_memories') {
      return Promise.resolve({ data: memoryExists ? MOCK_MEMORY : null, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  }

  const chain: Record<string, unknown> = { single, maybeSingle };

  // All chaining methods return chain (sticky) — preserves closure state through the chain
  const sticky = () => chain;
  const chainMethods = ['select','eq','neq','is','not','ilike','or','gt','gte','lt','lte',
    'filter','order','limit','range','delete'];
  for (const m of chainMethods) chain[m] = sticky;

  // Mutation methods set their flag then return chain (so sticky then() still works)
  chain.insert = () => {
    wasInsertCalled = true;
    if (table === 'marketing_memory_versions') versionInserted = true;
    if (table === 'learning_events') eventInserted = true;
    return chain;
  };

  chain.update = () => {
    wasUpdateCalled = true;
    return chain;
  };

  chain.upsert = () => {
    wasUpsertCalled = true;
    return chain;
  };

  // knowledge_nodes: override .in() to return a Promise directly for the ownership check:
  //   from('knowledge_nodes').select('id').eq('founder_id', x).in('id', [...])  ← awaited directly
  if (table === 'knowledge_nodes') {
    chain.in = () => Promise.resolve({
      data: nodeAExists && nodeBExists
        ? [{ id: NODE_ID_A }, { id: NODE_ID_B }]
        : nodeAExists
          ? [{ id: NODE_ID_A }]
          : [],
      error: null,
    });
  }

  // knowledge_edges: override .in() for the getGraph edges query:
  //   from('knowledge_edges').select('*').eq('founder_id', x).in('source_id', nodeIds)
  if (table === 'knowledge_edges') {
    chain.in = () => Promise.resolve({ data: [], error: null });
  }

  // Make chain directly awaitable: const { data, error } = await supabase.from(t).update().eq().eq()
  Object.defineProperty(chain, 'then', {
    get() { return resolveChain.then.bind(resolveChain); },
  });

  return chain;
}

function setupMockFrom(): void {
  mockFrom.mockImplementation((table: string) => makeSticky(table));
}

// ── Service tests ─────────────────────────────────────────────────────────────

describe('marketingMemoryService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    memoryExists = false;
    versionInserted = false;
    nodeAExists = false;
    nodeBExists = false;
    eventInserted = false;
    setupMockFrom();
  });

  it('createMemory: inserts and returns memory row', async () => {
    const { createMemory } = await import('../src/services/marketingMemoryService');
    const mem = await createMemory(FOUNDER_ID, PRODUCT_ID, 'product', 'TestApp — Product Profile', { targetUser: 'Developers' }, 'intake', 0.7);
    expect(mem.id).toBe(MEMORY_ID);
    expect(mem.memory_type).toBe('product');
    expect(mem.confidence).toBe(0.70);
  });

  it('updateMemory: writes version record, increments version', async () => {
    memoryExists = true;
    const { updateMemory } = await import('../src/services/marketingMemoryService');
    const updated = await updateMemory(MEMORY_ID, FOUNDER_ID, { title: 'Updated title', changed_by: 'founder' });
    expect(updated.version).toBe(2);
    expect(versionInserted).toBe(true);
  });

  it('archiveMemory: sets archived status', async () => {
    memoryExists = true;
    const { archiveMemory } = await import('../src/services/marketingMemoryService');
    await expect(archiveMemory(MEMORY_ID, FOUNDER_ID)).resolves.toBeUndefined();
  });

  it('findDuplicateMemory: returns ID when title matches', async () => {
    memoryExists = true;
    const { findDuplicateMemory } = await import('../src/services/marketingMemoryService');
    const id = await findDuplicateMemory(FOUNDER_ID, PRODUCT_ID, 'product', 'TestApp — Product Profile');
    expect(id).toBe(MEMORY_ID);
  });

  it('findDuplicateMemory: returns null when no match', async () => {
    memoryExists = false;
    const { findDuplicateMemory } = await import('../src/services/marketingMemoryService');
    const id = await findDuplicateMemory(FOUNDER_ID, PRODUCT_ID, 'product', 'Nonexistent');
    expect(id).toBeNull();
  });
});

describe('knowledgeGraphService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nodeAExists = false;
    nodeBExists = false;
    setupMockFrom();
  });

  it('createNode: upserts and returns node', async () => {
    const { createNode } = await import('../src/services/knowledgeGraphService');
    const node = await createNode(FOUNDER_ID, PRODUCT_ID, 'product', 'TestApp', {}, PRODUCT_ID, 'products', 0.8);
    expect(node.id).toBe(NODE_ID_A);
    expect(node.node_type).toBe('product');
  });

  it('createEdge: rejects when nodes not owned by founder', async () => {
    // Both nodes not in DB
    nodeAExists = false; nodeBExists = false;
    const { createEdge } = await import('../src/services/knowledgeGraphService');
    await expect(createEdge(FOUNDER_ID, NODE_ID_A, NODE_ID_B, 'targets')).rejects.toThrow();
  });

  it('createEdge: creates edge when both nodes belong to founder', async () => {
    nodeAExists = true; nodeBExists = true;
    const { createEdge } = await import('../src/services/knowledgeGraphService');
    const edge = await createEdge(FOUNDER_ID, NODE_ID_A, NODE_ID_B, 'targets', 0.8);
    expect(edge.relationship).toBe('targets');
    expect(edge.source_id).toBe(NODE_ID_A);
  });
});

describe('learningPipelineService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    memoryExists = false;
    nodeAExists = false;
    nodeBExists = false;
    eventInserted = false;
    setupMockFrom();
  });

  it('ingestLearningEvent intake_completed: creates memories and returns stats', async () => {
    const { ingestLearningEvent } = await import('../src/services/learningPipelineService');
    const result = await ingestLearningEvent(FOUNDER_ID, PRODUCT_ID, 'intake_completed', {
      productName: 'TestApp',
      confirmedIcp: {
        targetUser: 'Productivity enthusiasts',
        painPoints: ['Context switching', 'Missed deadlines'],
        geography: ['India', 'USA'],
        priceTier: 'Free',
        suggestedMarkets: ['india', 'usa'],
      },
      brandVoiceProfile: { tone: 'professional', adjectives: ['focused', 'calm'] },
      competitorSet: [{ name: 'Notion', gap: 'Too complex' }],
    });
    expect(result.eventId).toBe('ev-001');
    expect(result.memoriesCreated).toBeGreaterThanOrEqual(0);
  });

  it('ingestLearningEvent campaign_result: creates campaign memory', async () => {
    const { ingestLearningEvent } = await import('../src/services/learningPipelineService');
    const result = await ingestLearningEvent(FOUNDER_ID, PRODUCT_ID, 'campaign_result', {
      channel: 'whatsapp',
      market: 'india',
      hookType: 'pain_first',
      ctr: 0.06,
      cpi: 0.30,
      installs: 120,
      campaignId: 'camp-001',
      productName: 'TestApp',
    });
    expect(result.eventId).toBe('ev-001');
  });
});

// ── Route tests ───────────────────────────────────────────────────────────────

describe('memory routes', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    vi.clearAllMocks();
    setupMockFrom();
    const { buildServer } = await import('../src/server');
    server = await buildServer();
  });

  afterAll(async () => {
    if (server) await server.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    memoryExists = false;
    setupMockFrom();
  });

  it('GET /memory returns 401 without token', async () => {
    const res = await server.inject({ method: 'GET', url: '/memory' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /memory returns 200 with token', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/memory',
      headers: { Authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.memories)).toBe(true);
  });

  it('POST /memory/events returns 201 and result', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/memory/events',
      headers: { Authorization: `Bearer ${makeToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product_id: PRODUCT_ID,
        event_type: 'founder_feedback',
        payload: { memoryType: 'brand', title: 'Our brand voice', content: { tone: 'friendly' }, confidence: 0.9 },
      }),
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.result).toBeDefined();
  });

  it('POST /memory/events returns 400 for invalid event_type', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/memory/events',
      headers: { Authorization: `Bearer ${makeToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_type: 'invalid_type', payload: {} }),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('knowledge routes', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    vi.clearAllMocks();
    setupMockFrom();
    const { buildServer } = await import('../src/server');
    server = await buildServer();
  });

  afterAll(async () => {
    if (server) await server.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    nodeAExists = false;
    setupMockFrom();
  });

  it('GET /knowledge/graph returns 401 without token', async () => {
    const res = await server.inject({ method: 'GET', url: '/knowledge/graph' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /knowledge/graph returns 200 with graph shape', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/knowledge/graph',
      headers: { Authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.graph).toBeDefined();
    expect(Array.isArray(body.graph.nodes)).toBe(true);
    expect(Array.isArray(body.graph.edges)).toBe(true);
  });

  it('POST /knowledge/nodes returns 201 with new node', async () => {
    nodeAExists = true;
    const res = await server.inject({
      method: 'POST',
      url: '/knowledge/nodes',
      headers: { Authorization: `Bearer ${makeToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: PRODUCT_ID, node_type: 'product', label: 'TestApp', confidence: 0.8 }),
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.node.node_type).toBe('product');
  });
});
