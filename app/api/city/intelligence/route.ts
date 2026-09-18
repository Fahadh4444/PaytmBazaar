import { errorResponse } from "@/app/api/_lib/errors";
import { getCachedCityIntelligence, getIntelligenceDeps } from "@/merchant-intelligence/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/city/intelligence
 *
 * What is happening across the city this week: totals, a daily sales trend,
 * growth by Bazaar and by category (groups under MIN_COHORT_SIZE hidden), and
 * one data-backed headline. Aggregates only; no merchant is identifiable.
 */
export async function GET() {
  try {
    return Response.json(await getCachedCityIntelligence(getIntelligenceDeps()));
  } catch (error) {
    return errorResponse(error);
  }
}
