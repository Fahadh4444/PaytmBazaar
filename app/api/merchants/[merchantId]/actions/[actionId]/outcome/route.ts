import { errorResponse } from "@/app/api/_lib/errors";
import { measureActionOutcome } from "@/merchant-intelligence";
import { getIntelligenceDeps, onMerchantActionChanged } from "@/merchant-intelligence/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/merchants/:merchantId/actions/:actionId/outcome
 *
 * Measures an executed action's outcome with M2M (the 7 days from execution
 * against the 7 before), saves it and remembers it. Returns `pending_data`
 * until those days exist.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ merchantId: string; actionId: string }> },
) {
  const { merchantId, actionId } = await params;
  try {
    const result = await measureActionOutcome(getIntelligenceDeps(), { merchantId, actionId });
    if (result.status === "measured") onMerchantActionChanged(merchantId);
    return Response.json(result, { status: result.status === "pending_data" ? 202 : 200 });
  } catch (error) {
    return errorResponse(error);
  }
}
