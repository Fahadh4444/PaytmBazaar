import { badRequest, errorResponse } from "@/app/api/_lib/errors";
import { analyzeMerchantIntelligence } from "@/merchant-intelligence";
import { getCachedBasics, getCachedExplanation, getIntelligenceDeps } from "@/merchant-intelligence/server";
import { contextFromUrl } from "@/merchant-intelligence/context-request";

export const dynamic = "force-dynamic";

/**
 * GET /api/merchants/:merchantId/intelligence[?view=basic][&from=YYYY-MM-DD&to=YYYY-MM-DD]
 *
 * The merchant's intelligence for the latest 7 days against the 7 before, or
 * for an explicit period.
 *   view=basic  numbers, priorities and the proposed action only (fast, no AI)
 *   default     also remembered history and the AI summary
 * Latest-period results are cached; explicit periods are always recomputed.
 */
export async function GET(request: Request, { params }: { params: Promise<{ merchantId: string }> }) {
  const { merchantId } = await params;
  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const basicOnly = url.searchParams.get("view") === "basic";
  if ((from === null) !== (to === null)) return badRequest("Pass both from and to, or neither.");

  try {
    const context = contextFromUrl(url);
    const deps = getIntelligenceDeps();
    if (from && to) return Response.json(await analyzeMerchantIntelligence(deps, { merchantId, current: { from, to }, context }));

    const basics = await getCachedBasics(deps, merchantId, context);
    if (basicOnly) return Response.json(basics);
    return Response.json({ ...basics, ...(await getCachedExplanation(deps, merchantId, context)) });
  } catch (error) {
    return errorResponse(error);
  }
}
