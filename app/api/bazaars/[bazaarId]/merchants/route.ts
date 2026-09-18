import { errorResponse } from "@/app/api/_lib/errors";
import { getPaytmDataSource } from "@/lib/paytm";

export const dynamic = "force-dynamic";

/**
 * GET /api/bazaars/:bazaarId/merchants
 *
 * Public profiles of a Bazaar's merchants (ID, name, category), so the UI can
 * open the right merchant. Contact details are never included.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ bazaarId: string }> }) {
  const { bazaarId } = await params;
  try {
    const merchants = await getPaytmDataSource().getMerchantsByBazaar(bazaarId);
    return Response.json({
      merchants: merchants.map((m) => ({ mid: m.mid, name: m.name, category: m.category })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
