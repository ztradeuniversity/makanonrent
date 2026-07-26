/* GET  /api/admin/settings   → { approvalChain, autoPublish }
   POST /api/admin/settings   → { approvalChain?, autoPublish? }

   CEO-only writes. These two values decide how much independent review a
   property gets before it reaches the public site, which makes them
   governance configuration rather than preferences — every change is
   audited with its before/after value. */
import { json, preflight } from '../../utils/cors.js';
import { getServiceClient } from '../../utils/supabase.js';
import { requireCapability } from '../../utils/rbac.js';
import { CHAINS, getWorkflowConfig } from '../../utils/approval-chain.js';
import { auditFor } from '../../utils/audit.js';

export async function onRequestOptions(context) {
  return preflight(context.env);
}

export async function onRequestGet(context) {
  var env = context.env;
  var auth = await requireCapability(context, 'settings.read');
  if (auth.response) return auth.response;

  try {
    var cfg = await getWorkflowConfig(env);
    return json(env, {
      approvalChain: cfg.chainKey,
      autoPublish: cfg.autoPublish,
      availableChains: Object.keys(CHAINS)
    });
  } catch (e) {
    return json(env, { error: (e && e.message) || 'Could not load settings.' }, 500);
  }
}

export async function onRequestPost(context) {
  var env = context.env;
  var auth = await requireCapability(context, 'settings.write');
  if (auth.response) return auth.response;

  var body;
  try {
    body = await context.request.json();
  } catch (e) {
    return json(env, { error: 'Request body must be valid JSON.' }, 400);
  }

  var db = getServiceClient(env);
  var audit = auditFor(env, auth.user, context.request);

  try {
    var before = await getWorkflowConfig(env);
    var writes = [];

    if (body.approvalChain !== undefined) {
      if (!CHAINS[body.approvalChain]) {
        return json(env, {
          error: 'approvalChain must be one of: ' + Object.keys(CHAINS).join(', ') + '.'
        }, 422);
      }
      writes.push({ key: 'approval_chain', value: body.approvalChain });
    }

    if (body.autoPublish !== undefined) {
      if (typeof body.autoPublish !== 'boolean') {
        return json(env, { error: 'autoPublish must be true or false.' }, 422);
      }
      writes.push({ key: 'auto_publish', value: body.autoPublish });
    }

    if (!writes.length) {
      return json(env, { error: 'Provide approvalChain and/or autoPublish.' }, 422);
    }

    for (var i = 0; i < writes.length; i++) {
      var res = await db.from('admin_settings').upsert({
        key: writes[i].key,
        value: writes[i].value,
        updated_by: auth.user.id,
        updated_at: new Date().toISOString()
      }, { onConflict: 'key' });
      if (res.error) throw res.error;
    }

    var after = await getWorkflowConfig(env);
    await audit('update_workflow_settings', 'admin_settings', null, {
      before: { approvalChain: before.chainKey, autoPublish: before.autoPublish },
      after: { approvalChain: after.chainKey, autoPublish: after.autoPublish }
    });

    return json(env, { ok: true, approvalChain: after.chainKey, autoPublish: after.autoPublish });
  } catch (e) {
    return json(env, { error: (e && e.message) || 'Could not update settings.' }, 500);
  }
}
