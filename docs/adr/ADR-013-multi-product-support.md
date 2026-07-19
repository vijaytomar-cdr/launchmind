# ADR-013: Multi-Product Support
Status: Accepted
Date: July 2026

## Context
Products are already associated with workspaces via `products.workspace_id`. Founders need to switch between active products across the UI. Plan-based product limits must be enforced (Free: 1, Solo: 1, Builder: 3, Studio: 10).

## Decision
**Active product state** is stored on `founders.active_product_id` (new column). The sidebar and all product-scoped pages read this to know which product is "in context."

**Switching active product** via `POST /products/:id/activate` — sets `founders.active_product_id` and returns the product with full profile.

**Plan limits** enforced in Decision Engine (not AI):
- Count active (non-archived) products for founder
- If count >= plan limit → reject 402 with `PLAN_REQUIRED` error code
- Free/Solo: 1 product. Builder: 3. Studio: 10.

**Workspace association**: products can optionally belong to a workspace (`workspace_id`). If no workspace is active, the personal workspace is implied.

## Consequences
- `founders.active_product_id` is nullable — NULL means "no product selected yet" (new founder state)
- Product-scoped sidebar shows active product name + quick-switch dropdown
- All product-scoped pages can read active product from session context
- Plan limit check runs in `POST /products/scrape` and `POST /products/setup/complete` — both intake paths
- Archiving a product that is the `active_product_id` clears the active product
