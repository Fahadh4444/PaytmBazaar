/**
 * The first screen: the Bazaar seen from above, through the clouds.
 *
 * Everything interactive lives in the client component; this stays a server
 * component so the page metadata and the environment markup render on the
 * server.
 */
import LandingScreen from "@/components/bazaar/LandingScreen";

export default function Home() {
  return <LandingScreen />;
}
