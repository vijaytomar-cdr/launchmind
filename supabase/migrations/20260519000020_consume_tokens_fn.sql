-- @file 20260519_000020_consume_tokens_fn.sql
-- @description Two Postgres helper functions for atomic token operations.
--   consume_tokens: FOR UPDATE lock + deduction. Returns NULL (unlimited), -1 (insufficient),
--                   or new balance integer.
--   add_tokens: atomic addition for top-up purchases.
--   Both called via supabase.rpc() from backend services.
--   Idempotent: CREATE OR REPLACE — safe to run twice.

CREATE OR REPLACE FUNCTION consume_tokens(
  p_founder_id UUID,
  p_cost       INT
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_balance     INT;
  v_new_balance INT;
BEGIN
  SELECT token_balance INTO v_balance
  FROM founders
  WHERE id = p_founder_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Founder not found: %', p_founder_id;
  END IF;

  -- NULL = subscription founder with unlimited tokens
  IF v_balance IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_balance < p_cost THEN
    RETURN -1;
  END IF;

  v_new_balance := v_balance - p_cost;
  UPDATE founders SET token_balance = v_new_balance, updated_at = NOW() WHERE id = p_founder_id;
  RETURN v_new_balance;
END;
$$;

CREATE OR REPLACE FUNCTION add_tokens(
  p_founder_id UUID,
  p_amount     INT
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_balance INT;
BEGIN
  UPDATE founders
  SET token_balance = COALESCE(token_balance, 0) + p_amount,
      updated_at    = NOW()
  WHERE id = p_founder_id
  RETURNING token_balance INTO v_new_balance;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Founder not found: %', p_founder_id;
  END IF;

  RETURN v_new_balance;
END;
$$;

GRANT EXECUTE ON FUNCTION consume_tokens(UUID, INT) TO service_role;
GRANT EXECUTE ON FUNCTION add_tokens(UUID, INT) TO service_role;
