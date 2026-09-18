import { errorResponse } from "@/app/api/_lib/errors";
import { getIntelligenceDeps, warmBazaar } from "@/merchant-intelligence/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/bazaars/:bazaarId/warm
 *
 * Starts preparing numbers and AI summaries for the Bazaar's merchants in the
 * background and returns immediately, so opening a shop is near-instant.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ bazaarId: string }> }) {
  const { bazaarId } = await params;
  try {
    const merchants = await warmBazaar(getIntelligenceDeps(), bazaarId);
    return Response.json({ warming: merchants }, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
