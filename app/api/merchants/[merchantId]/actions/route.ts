import { badRequest, errorResponse, readJson } from "@/app/api/_lib/errors";
import { executeApprovedAction, getMerchantBasics, proposeScenarioAction } from "@/merchant-intelligence";
import { getIntelligenceDeps, onMerchantActionChanged } from "@/merchant-intelligence/server";
import { contextFromValue } from "@/merchant-intelligence/context-request";

export const dynamic = "force-dynamic";

/**
 * POST /api/merchants/:merchantId/actions
 * Body: { "actionId": "<uuid>", "approved": true }
 *
 * Runs a proposed action through n8n, only with explicit approval. The
 * response reports what really happened: executed, failed, or approved but
 * pending because no executor is configured.
 */
export async function POST(request: Request, { params }: { params: Promise<{ merchantId: string }> }) {
  const { merchantId } = await params;
  const body = await readJson(request);
  if (!body) return badRequest("An action request is required.");

  try {
    const deps = getIntelligenceDeps();
    let actionId = typeof body.actionId === "string" ? body.actionId : null;
    if (!actionId && body.context) {
      if (body.approved !== true) return badRequest("Explicit approval is required.");
      if (!deps.actions) return Response.json({ error: { code: "action_store_unavailable", message: "Action storage is not available." } }, { status: 503 });
      const context = contextFromValue(body.context);
      const basics = await getMerchantBasics(deps, { merchantId, context });
      const candidate = proposeScenarioAction(basics.relevance, basics.m2m.contextImpact?.forecast, context);
      if (!candidate) return badRequest("This scenario doesn't call for an offer, so no email was sent.");
      const created = await deps.actions.create({
        merchantId,
        type: candidate.type,
        parameters: { ...candidate.parameters },
        description: candidate.description,
        basis: {
          ...candidate.basis,
          context,
          source: "context_simulation",
          forecast: basics.m2m.contextImpact?.forecast ?? null,
        },
      });
      actionId = created.id;
    }
    if (!actionId) return badRequest("actionId or an approved simulation context is required.");
    const outcome = await executeApprovedAction(deps, {
      merchantId,
      actionId,
      approved: body.approved,
    });
    onMerchantActionChanged(merchantId);
    const status = outcome.execution?.status === "failed" ? 502 : outcome.execution ? 200 : 202;
    return Response.json(outcome, { status });
  } catch (error) {
    return errorResponse(error);
  }
}
