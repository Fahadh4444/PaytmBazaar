/**
 * The Bazaar City: the entry point into the Bazaar network.
 *
 * The screen itself is interactive, so it lives in a client component; this
 * stays a server component to own the route metadata.
 */
import type { Metadata } from "next";

import CityScreen from "@/components/city/CityScreen";

export const metadata: Metadata = {
  title: "The Bazaar City — Paytm Bazaar",
  description: "Six Bazaars, one city. Explore. Discover. Grow Together.",
};

export default function CityPage() {
  return <CityScreen />;
}
