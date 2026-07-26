/* MakanOnRent — property approval workflow configuration.
   Implements the CEO-configurable chain and the Auto Publish switch.

   The chain is data, and it lives in admin_settings rather than in code,
   because the brief makes it a CEO decision that changes at runtime —
   putting it in a constant would mean a deploy every time the CEO changes
   their mind about how much review a listing needs. */
import { getServiceClient } from './supabase.js';

export var CHAINS = {
  manager_only:     ['manager'],
  manager_aceo:     ['manager', 'assistant_ceo'],
  manager_ceo:      ['manager', 'ceo'],
  manager_aceo_ceo: ['manager', 'assistant_ceo', 'ceo']
};

export var STAGE_STATE = {
  manager:       'pending_manager',
  assistant_ceo: 'pending_assistant_ceo',
  ceo:           'pending_ceo'
};

export async function getWorkflowConfig(env) {
  var db = getServiceClient(env);
  var res = await db.from('admin_settings').select('key, value').in('key', ['approval_chain', 'auto_publish']);
  if (res.error) throw res.error;

  var map = {};
  (res.data || []).forEach(function (r) { map[r.key] = r.value; });

  var chainKey = map.approval_chain || 'manager_only';
  if (!CHAINS[chainKey]) chainKey = 'manager_only';   // unknown config fails safe, not open

  return {
    chainKey: chainKey,
    chain: CHAINS[chainKey],
    autoPublish: map.auto_publish === true
  };
}

/* The stage a listing is waiting on, given its stored approval_state.
   A listing with no approval_state yet (every row that predates this
   feature, plus every fresh public submission) is waiting on the first
   stage of the chain — which is what makes the change backward-compatible
   without a data backfill. */
export function currentStage(chain, approvalState) {
  if (!approvalState || approvalState === 'returned') return chain[0];
  for (var stage in STAGE_STATE) {
    if (STAGE_STATE[stage] === approvalState) return stage;
  }
  return null;   // approved / rejected — terminal, nothing is waiting
}

/* What happens after `stage` approves. Returns either the next stage to
   wait on, or null meaning "publish now".

   Auto Publish short-circuits the remaining tiers — but note it can only
   ever skip REVIEW stages. It cannot merge submitter and approver into
   one identity; that is blocked in the database by enforce_approval_sod
   (ADR §4) regardless of what this function returns. */
export function nextStage(chain, stage, autoPublish) {
  if (autoPublish) return null;
  var i = chain.indexOf(stage);
  /* A stage that is not in the chain is a programming error, and `null`
     here would mean PUBLISH — the most damaging possible interpretation
     of an unknown input. Fail closed instead: the caller's try/catch
     turns this into a 500 and the listing stays unpublished. */
  if (i === -1) throw new Error('Unknown approval stage: ' + stage);
  if (i === chain.length - 1) return null;
  return chain[i + 1];
}
