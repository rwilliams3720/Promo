// Shared commission-rate math used by api/commissions.js and api/sales.js
// (chargeback mode) so the two reports always agree on dollar amounts.

// Apply commission rate — checks minimum threshold, subcategory override, FS rate, then product default
export function applyRate(structure, product, subcategory, premiumShare, writtenPremium, isFS) {
  const productCfg = structure?.rates?.[product];
  if (!productCfg) return 0;

  // Minimum premium threshold — whole sale must exceed this before any commission
  if (productCfg.minimum != null && writtenPremium < productCfg.minimum) return 0;

  // Subcategory override takes priority over all product-level settings
  if (subcategory && productCfg.subcategories?.[subcategory]) {
    const sub = productCfg.subcategories[subcategory];
    if (!sub.type || sub.type === 'none') return 0;
    let subComm = 0;
    if (sub.type === 'percent') subComm = premiumShare * ((sub.rate || 0) / 100);
    else if (sub.type === 'flat') subComm = sub.rate || 0;
    if (structure.cap_per_policy != null && subComm > structure.cap_per_policy) subComm = structure.cap_per_policy;
    return subComm;
  }

  // No subcategory override — use product default or FS rate
  if (!productCfg.type || productCfg.type === 'none') return 0;

  // Financial service rate overrides the base rate (still uses product's type)
  const rate = (isFS && productCfg.fs_rate != null) ? productCfg.fs_rate : (productCfg.rate || 0);
  let comm = 0;
  if (productCfg.type === 'percent') comm = premiumShare * (rate / 100);
  else if (productCfg.type === 'flat') comm = rate;
  if (structure.cap_per_policy != null && comm > structure.cap_per_policy) comm = structure.cap_per_policy;
  return comm;
}

// Computes the commission a chargeback deducts for one sale, honoring the agent's
// per-product structure override (agent_roster.commission_product_overrides).
// override: a specific structureId → only that structure's rate applies.
//           'both' or unset → sum every assigned structure with a non-zero rate
//           for the product — this mirrors the earned-side default (sum across
//           all assigned structures), so an un-configured overlap stays consistent
//           between what was earned and what gets clawed back.
export function chargebackCommission(structList, product, subcategory, share, premium, isFS, override) {
  if (override && override !== 'both') {
    const struct = structList.find(s => s.id === override);
    return struct ? applyRate(struct, product, subcategory, share, premium, isFS) : 0;
  }
  return structList.reduce((sum, st) => sum + applyRate(st, product, subcategory, share, premium, isFS), 0);
}

// Builds a getStructureList(agentId) lookup from the standard roster/junction rows.
export function buildStructureListLookup(roster, structureById, junctionRows) {
  const agentById = {};
  for (const a of roster) agentById[a.agent_id] = a;

  const multiByAgent = {};
  for (const row of junctionRows) {
    (multiByAgent[row.agent_id] ||= []).push(structureById[row.commission_structure_id]);
  }

  const getStructureList = (agentId) => {
    const multi = multiByAgent[agentId];
    if (multi?.length) return multi.filter(Boolean);
    const single = structureById[agentById[agentId]?.commission_structure_id];
    return single ? [single] : [];
  };

  return { agentById, getStructureList };
}
