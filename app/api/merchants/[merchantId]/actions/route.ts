import { badRequest, errorResponse, readJson } from "@/app/api/_lib/errors";
import { executeApprovedAction } from "@/merchant-intelligence";
import { getIntelligenceDeps, onMerchantActionChanged } from "@/merchant-intelligence/server";

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
  if (!body || typeof body.actionId !== "string") return badRequest("actionId is required.");

  try {
    const outcome = await executeApprovedAction(getIntelligenceDeps(), {
      merchantId,
      actionId: body.actionId,
      approved: body.approved,
    });
    onMerchantActionChanged(merchantId);
    const status = outcome.execution?.status === "failed" ? 502 : outcome.execution ? 200 : 202;
    return Response.json(outcome, { status });
  } catch (error) {
    return errorResponse(error);
  }
}
