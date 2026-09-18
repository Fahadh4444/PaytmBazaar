/**
 * A single Bazaar street.
 *
 * Every Bazaar shares one street render in this prototype — the route only
 * decides which Bazaar's name and id the screen is working under.
 */
import { notFound } from "next/navigation";

import BazaarScreen from "@/components/bazaar-screen/BazaarScreen";
import { bazaarById, bazaars } from "@/data/bazaars";

export function generateStaticParams() {
  return bazaars.map((bazaar) => ({ bazaarId: bazaar.id }));
}

export async function generateMetadata({ params }: PageProps<"/bazaar/[bazaarId]">) {
  const { bazaarId } = await params;
  const bazaar = bazaarById(bazaarId);

  return { title: bazaar ? `${bazaar.name} Bazaar — Paytm Bazaar` : "Bazaar" };
}

export default async function BazaarPage({ params }: PageProps<"/bazaar/[bazaarId]">) {
  const { bazaarId } = await params;
  const bazaar = bazaarById(bazaarId);

  if (!bazaar) notFound();

  return <BazaarScreen bazaar={bazaar} />;
}
