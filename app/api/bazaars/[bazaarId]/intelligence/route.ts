import { errorResponse } from "@/app/api/_lib/errors";
import { getCachedBazaarIntelligence, getIntelligenceDeps } from "@/merchant-intelligence/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/bazaars/:bazaarId/intelligence
 *
 * What is happening in one Bazaar this week: totals, a daily sales trend,
 * growth by category (small groups hidden), how many shops are growing or
 * declining (counts only), Bazaar vs city impact, and one data-backed headline.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ bazaarId: string }> }) {
  const { bazaarId } = await params;
  try {
    return Response.json(await getCachedBazaarIntelligence(getIntelligenceDeps(), bazaarId));
  } catch (error) {
    return errorResponse(error);
  }
}
