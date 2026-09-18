import { errorResponse } from "@/app/api/_lib/errors";
import { getCachedExplanation, getIntelligenceDeps } from "@/merchant-intelligence/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/merchants/:merchantId/insight
 *
 * The slower half of the intelligence: remembered history and the
 * plain-language AI summary for the latest period. Cached once generated.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ merchantId: string }> }) {
  const { merchantId } = await params;
  try {
    return Response.json(await getCachedExplanation(getIntelligenceDeps(), merchantId));
  } catch (error) {
    return errorResponse(error);
  }
}
