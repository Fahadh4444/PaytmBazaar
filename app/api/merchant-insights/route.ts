import { getMerchantInsightSnapshot } from "@/lib/merchant-insights/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const bazaarId = url.searchParams.get("bazaarId")?.trim();
  const merchantName = url.searchParams.get("merchantName")?.trim();

  if (!bazaarId || !merchantName) {
    return Response.json({ error: "Bazaar and merchant are required." }, { status: 400 });
  }

  try {
    const insight = await getMerchantInsightSnapshot(bazaarId, merchantName);
    if (!insight) return Response.json({ error: "Merchant data is not available yet." }, { status: 404 });
    return Response.json(insight);
  } catch {
    return Response.json({ error: "Merchant analysis could not be loaded." }, { status: 500 });
  }
}
