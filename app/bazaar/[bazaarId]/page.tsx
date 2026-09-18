/**
 * A single Bazaar. Placeholder: it exists so the City -> Bazaar navigation is
 * real. Merchants, transactions and Bazaar-level insight are later slices.
 */
import Link from "next/link";
import { notFound } from "next/navigation";

import { bazaarById, bazaars } from "@/data/bazaars";

import styles from "./bazaar.module.css";

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

  return (
    <main className={styles.page} style={{ ["--bazaar" as string]: bazaar.color }}>
      <Link className={styles.back} href="/city">
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M19 12H5" />
          <path d="m11 6-6 6 6 6" />
        </svg>
        Back to the city
      </Link>

      <div className={styles.card}>
        <p className={styles.eyebrow}>Paytm Bazaar</p>
        <h1 className={styles.title}>{bazaar.name} Bazaar</h1>
        <p className={styles.category}>
          <span className={styles.dot} />
          {bazaar.category}
        </p>
        <p className={styles.note}>Bazaar page coming next.</p>
      </div>
    </main>
  );
}
