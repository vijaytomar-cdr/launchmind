/**
 * @file promptRegistry.ts
 * @description Prompt Registry — resolves, registers, and versions AI prompts.
 *   Prompts are stored in the `prompts` table. Each prompt_id has one active version.
 *   resolvePrompt(): fetch the active (or pinned) version of a prompt.
 *   registerPrompt(): create a new version, archive the old active one.
 *   listPrompts(): list all prompts with their latest active version.
 * @security Service-role only. No founder-scoped data. Prompts are system config, not PII.
 * @dependencies supabaseAdmin
 */

import { getSupabaseAdmin } from './supabaseAdmin';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Prompt {
  id: string;
  promptId: string;
  version: number;
  purpose: string;
  owner: string;
  model: 'sonnet' | 'haiku';
  systemTemplate: string | null;
  userTemplate: string;
  inputSchema: Record<string, unknown> | null;
  outputSchema: Record<string, unknown> | null;
  status: 'draft' | 'active' | 'archived';
  tokenCost: number;
  createdAt: string;
}

export interface CreatePromptInput {
  promptId: string;
  purpose: string;
  owner?: string;
  model: 'sonnet' | 'haiku';
  systemTemplate?: string;
  userTemplate: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  tokenCost?: number;
  status?: 'draft' | 'active';
}

// ── Resolve ───────────────────────────────────────────────────────────────────

/**
 * Resolves the active (or specified) version of a prompt.
 * @param promptId - Stable prompt identifier (e.g. 'strategy_generation')
 * @param version  - Specific version; defaults to latest active
 * @returns Prompt record or null if not found
 */
export async function resolvePrompt(
  promptId: string,
  version?: number,
): Promise<Prompt | null> {
  const supabase = getSupabaseAdmin();

  let query = supabase
    .from('prompts')
    .select('*')
    .eq('prompt_id', promptId);

  if (version !== undefined) {
    query = query.eq('version', version);
  } else {
    query = query.eq('status', 'active');
  }

  const { data, error } = await query.order('version', { ascending: false }).limit(1).single();

  if (error || !data) return null;
  return mapPrompt(data as RawPromptRow);
}

// ── List ──────────────────────────────────────────────────────────────────────

/**
 * Lists all prompts with their latest active version.
 * Returns one row per prompt_id, the active version.
 */
export async function listPrompts(): Promise<Prompt[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('prompts')
    .select('*')
    .eq('status', 'active')
    .order('prompt_id', { ascending: true });

  if (error || !data) return [];
  return (data as RawPromptRow[]).map(mapPrompt);
}

/**
 * Lists all versions of a specific prompt_id (active, draft, archived).
 */
export async function listPromptVersions(promptId: string): Promise<Prompt[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('prompts')
    .select('*')
    .eq('prompt_id', promptId)
    .order('version', { ascending: false });

  if (error || !data) return [];
  return (data as RawPromptRow[]).map(mapPrompt);
}

// ── Register ──────────────────────────────────────────────────────────────────

/**
 * Creates a new version of a prompt. If activating, archives the current active version first.
 * @param input - New prompt data
 * @returns The created Prompt record
 */
export async function registerPrompt(input: CreatePromptInput): Promise<Prompt> {
  const supabase = getSupabaseAdmin();

  const isActivating = (input.status ?? 'active') === 'active';

  // Find the next version number
  const { data: existing } = await supabase
    .from('prompts')
    .select('version')
    .eq('prompt_id', input.promptId)
    .order('version', { ascending: false })
    .limit(1)
    .single();

  const nextVersion = (existing?.version ?? 0) + 1;

  if (isActivating) {
    // Archive the current active version
    await supabase
      .from('prompts')
      .update({ status: 'archived' })
      .eq('prompt_id', input.promptId)
      .eq('status', 'active');
  }

  const { data, error } = await supabase
    .from('prompts')
    .insert({
      prompt_id:       input.promptId,
      version:         nextVersion,
      purpose:         input.purpose,
      owner:           input.owner ?? 'system',
      model:           input.model,
      system_template: input.systemTemplate ?? null,
      user_template:   input.userTemplate,
      input_schema:    input.inputSchema ?? null,
      output_schema:   input.outputSchema ?? null,
      status:          input.status ?? 'active',
      token_cost:      input.tokenCost ?? 0,
    })
    .select('*')
    .single();

  if (error || !data) throw error ?? new Error('Failed to register prompt');
  return mapPrompt(data as RawPromptRow);
}

// ── Internal ──────────────────────────────────────────────────────────────────

interface RawPromptRow {
  id: string;
  prompt_id: string;
  version: number;
  purpose: string;
  owner: string;
  model: string;
  system_template: string | null;
  user_template: string;
  input_schema: Record<string, unknown> | null;
  output_schema: Record<string, unknown> | null;
  status: string;
  token_cost: number;
  created_at: string;
}

function mapPrompt(row: RawPromptRow): Prompt {
  return {
    id:             row.id,
    promptId:       row.prompt_id,
    version:        row.version,
    purpose:        row.purpose,
    owner:          row.owner,
    model:          row.model as 'sonnet' | 'haiku',
    systemTemplate: row.system_template,
    userTemplate:   row.user_template,
    inputSchema:    row.input_schema,
    outputSchema:   row.output_schema,
    status:         row.status as Prompt['status'],
    tokenCost:      row.token_cost,
    createdAt:      row.created_at,
  };
}
