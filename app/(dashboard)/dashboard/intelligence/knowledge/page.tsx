/**
 * @file app/(dashboard)/dashboard/intelligence/knowledge/page.tsx
 * @description Knowledge Graph explorer — shows marketing entity relationships.
 *   Founders see plain English ("Your WhatsApp channel targets Productivity users")
 *   not graph terminology. Groups nodes by type. Shows edge relationships inline.
 *   Includes node merge review for detected duplicates.
 * @security Auth token from Supabase session. All data via Fastify backend.
 * @dependencies lib/api, lib/supabase/client
 */

'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { api, ApiError } from '@/lib/api';
import type { KnowledgeGraph, KnowledgeNode, KnowledgeEdge, NodeType } from '@/lib/api';
import {
  IconRoute,
  IconArrowRight,
  IconTrash,
} from '@tabler/icons-react';

// ── Node type display config ──────────────────────────────────────────────────

const NODE_TYPE_META: Record<NodeType, { label: string; emoji: string; color: string; bg: string; border: string }> = {
  product:     { label: 'Products',     emoji: '📱', color: 'var(--sage)',   bg: 'var(--sage-d)',   border: 'var(--sage-b)' },
  feature:     { label: 'Features',     emoji: '✨', color: 'var(--sage)',   bg: 'var(--sage-d)',   border: 'var(--sage-b)' },
  persona:     { label: 'Personas',     emoji: '👤', color: 'var(--indigo)', bg: 'var(--indigo-d)', border: 'var(--indigo-b)' },
  icp:         { label: 'ICP',          emoji: '🎯', color: 'var(--indigo)', bg: 'var(--indigo-d)', border: 'var(--indigo-b)' },
  competitor:  { label: 'Competitors',  emoji: '⚔️', color: 'var(--danger)',    bg: 'var(--danger-d)',    border: 'var(--danger-b)' },
  campaign:    { label: 'Campaigns',    emoji: '📢', color: 'var(--indigo)', bg: 'var(--indigo-d)', border: 'var(--indigo-b)' },
  creative:    { label: 'Creatives',    emoji: '🎨', color: 'var(--indigo)', bg: 'var(--indigo-d)', border: 'var(--indigo-b)' },
  channel:     { label: 'Channels',     emoji: '📡', color: 'var(--sage)',   bg: 'var(--sage-d)',   border: 'var(--sage-b)' },
  review:      { label: 'Reviews',      emoji: '⭐', color: 'var(--amber)',  bg: 'var(--amber-d)',  border: 'var(--amber-b)' },
  market:      { label: 'Markets',      emoji: '🌍', color: 'var(--amber)',  bg: 'var(--amber-d)',  border: 'var(--amber-b)' },
  goal:        { label: 'Goals',        emoji: '🏆', color: 'var(--sage)',   bg: 'var(--sage-d)',   border: 'var(--sage-b)' },
  opportunity: { label: 'Opportunities', emoji: '🚀', color: 'var(--sage)',  bg: 'var(--sage-d)',   border: 'var(--sage-b)' },
  risk:        { label: 'Risks',        emoji: '⚠️', color: 'var(--danger)',    bg: 'var(--danger-d)',    border: 'var(--danger-b)' },
};

// Plain-English edge relationship phrases
const RELATIONSHIP_PHRASE: Record<string, string> = {
  targets:         'targets',
  competes_with:   'competes with',
  belongs_to:      'belongs to',
  influenced_by:   'is influenced by',
  validated_by:    'is validated by',
  generated_from:  'was generated from',
  has_feature:     'has feature',
  serves_persona:  'serves',
  appears_in:      'appears in',
  measured_by:     'is measured by',
  leads_to:        'leads to',
  blocks:          'blocks',
};

function ConfidenceDot({ value }: { value: number }) {
  const color = value >= 0.7 ? 'var(--sage)' : value >= 0.5 ? 'var(--amber)' : 'var(--ink3)';
  return (
    <span
      title={`${Math.round(value * 100)}% confidence`}
      style={{ width: 7, height: 7, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }}
    />
  );
}

function RelationshipRow({
  edge,
  node,
  allNodes,
  direction,
}: {
  edge: KnowledgeEdge;
  node: KnowledgeNode;
  allNodes: KnowledgeNode[];
  direction: 'out' | 'in';
}) {
  const otherId = direction === 'out' ? edge.target_id : edge.source_id;
  const other   = allNodes.find(n => n.id === otherId);
  if (!other) return null;

  const phrase = RELATIONSHIP_PHRASE[edge.relationship] ?? edge.relationship.replace(/_/g, ' ');
  const subject = direction === 'out' ? node : other;
  const object  = direction === 'out' ? other : node;
  const subjectMeta  = NODE_TYPE_META[subject.node_type];
  const objectMeta   = NODE_TYPE_META[object.node_type];

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 0', flexWrap: 'wrap' }}>
      <span style={{ fontSize: 11, fontWeight: 500, color: subjectMeta.color }}>{subject.label}</span>
      <IconArrowRight size={11} color="var(--ink3)" />
      <span style={{ fontSize: 11, color: 'var(--ink3)', fontStyle: 'italic' }}>{phrase}</span>
      <IconArrowRight size={11} color="var(--ink3)" />
      <span style={{ fontSize: 11, fontWeight: 500, color: objectMeta.color }}>{object.label}</span>
      <ConfidenceDot value={edge.weight} />
    </div>
  );
}

function NodeGroup({
  type,
  nodes,
  edges,
  allNodes,
  onDelete,
}: {
  type: NodeType;
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  allNodes: KnowledgeNode[];
  onDelete: (id: string) => void;
}) {
  const meta = NODE_TYPE_META[type];
  const [expanded, setExpanded] = useState(true);

  const nodeEdges = (nodeId: string) =>
    edges.filter(e => e.source_id === nodeId || e.target_id === nodeId);

  return (
    <div style={{ marginBottom: 16 }}>
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          display: 'flex', alignItems: 'center', gap: 7, padding: '7px 0',
          background: 'none', border: 'none', cursor: 'pointer', width: '100%',
        }}
      >
        <span style={{ fontSize: 14 }}>{meta.emoji}</span>
        <span className="font-display font-semibold" style={{ fontSize: 13, color: 'var(--ink)' }}>{meta.label}</span>
        <span style={{ fontSize: 11, color: 'var(--ink3)', marginLeft: 2 }}>({nodes.length})</span>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--ink3)' }}>{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {nodes.map(node => {
            const ne = nodeEdges(node.id);
            return (
              <div
                key={node.id}
                style={{
                  background: 'var(--surface)',
                  border: `1px solid ${meta.border}`,
                  borderRadius: 8,
                  padding: '12px 14px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: ne.length > 0 ? 8 : 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <ConfidenceDot value={node.confidence} />
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{node.label}</span>
                  </div>
                  <button
                    onClick={() => onDelete(node.id)}
                    title="Remove node"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, opacity: 0.4 }}
                  >
                    <IconTrash size={12} color="var(--ink3)" />
                  </button>
                </div>
                {ne.length > 0 && (
                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                    {ne.slice(0, 4).map(edge => (
                      <RelationshipRow
                        key={edge.id}
                        edge={edge}
                        node={node}
                        allNodes={allNodes}
                        direction={edge.source_id === node.id ? 'out' : 'in'}
                      />
                    ))}
                    {ne.length > 4 && (
                      <p style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 4 }}>
                        +{ne.length - 4} more relationship{ne.length - 4 !== 1 ? 's' : ''}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function KnowledgePage() {
  const supabase = createClient();
  const [graph, setGraph] = useState<KnowledgeGraph>({ nodes: [], edges: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      tokenRef.current = session.access_token;
      const { graph: g } = await api.knowledge.graph(session.access_token);
      setGraph(g);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load knowledge graph');
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const handleDeleteNode = useCallback(async (id: string) => {
    if (!tokenRef.current) return;
    if (!confirm('Remove this node and all its connections?')) return;
    try {
      await api.knowledge.deleteNode(id, tokenRef.current);
      setGraph(prev => ({
        nodes: prev.nodes.filter(n => n.id !== id),
        edges: prev.edges.filter(e => e.source_id !== id && e.target_id !== id),
      }));
    } catch { /* non-fatal */ }
  }, []);

  // Group nodes by type
  const nodesByType = graph.nodes.reduce<Partial<Record<NodeType, KnowledgeNode[]>>>((acc, node) => {
    if (!acc[node.node_type]) acc[node.node_type] = [];
    acc[node.node_type]!.push(node);
    return acc;
  }, {});

  const typesWithNodes = (Object.keys(nodesByType) as NodeType[]).sort();

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-5">
        <h1 className="font-display font-semibold" style={{ fontSize: 22, color: 'var(--ink)' }}>
          Knowledge Graph
        </h1>
        <p style={{ fontSize: 13, color: 'var(--ink2)', marginTop: 3 }}>
          How your products, channels, personas, and competitors are connected.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-[8px] px-4 py-3" style={{ background: 'var(--danger-d)', border: '1px solid var(--danger-b)', color: 'var(--danger)', fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Stats */}
      {!loading && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Entities', value: graph.nodes.length },
            { label: 'Connections', value: graph.edges.length },
            { label: 'Entity types', value: typesWithNodes.length },
            { label: 'Avg confidence', value: graph.nodes.length > 0 ? `${Math.round(graph.nodes.reduce((s, n) => s + n.confidence, 0) / graph.nodes.length * 100)}%` : '—' },
          ].map(s => (
            <div key={s.label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px' }}>
              <div className="font-mono" style={{ fontSize: 22, fontWeight: 500, color: 'var(--ink)', marginBottom: 2 }}>{s.value}</div>
              <div style={{ fontSize: 11, color: 'var(--ink3)' }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="text-center py-12" style={{ fontSize: 13, color: 'var(--ink3)' }}>Loading knowledge graph…</div>
      ) : graph.nodes.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--raised)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
            <IconRoute size={22} color="var(--ink3)" />
          </div>
          <h3 className="font-semibold mb-2" style={{ fontSize: 14, color: 'var(--ink)' }}>No knowledge graph yet</h3>
          <p style={{ fontSize: 13, color: 'var(--ink2)', maxWidth: 320 }}>
            The knowledge graph is built automatically when you complete product intake and run campaigns.
          </p>
        </div>
      ) : (
        <div>
          {typesWithNodes.map(type => (
            <NodeGroup
              key={type}
              type={type}
              nodes={nodesByType[type] ?? []}
              edges={graph.edges}
              allNodes={graph.nodes}
              onDelete={handleDeleteNode}
            />
          ))}
        </div>
      )}
    </div>
  );
}
