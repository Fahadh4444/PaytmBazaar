"use client";

import SceneDialog from "@/components/bazaar/SceneDialog";
import type { Shop } from "@/data/shops";

import styles from "./bazaar-screen.module.css";

type MerchantDialogProps = {
  shop: Shop | null;
  bazaarName: string;
  open: boolean;
  onClose: () => void;
};

/**
 * The window onto a merchant.
 *
 * Deliberately empty: it names the merchant and the Bazaar it trades in, and
 * nothing else. No figures are invented here, because none have been computed.
 */
export default function MerchantDialog({
  shop,
  bazaarName,
  open,
  onClose,
}: MerchantDialogProps) {
  return (
    <SceneDialog
      open={open}
      onClose={onClose}
      eyebrow="Merchant"
      title={shop ? shop.name : "Merchant"}
      wide
    >
      <hr className={styles.dialogRule} />

      <p className={styles.dialogLede}>{bazaarName}</p>

      <p className={styles.dialogEmpty}>Merchant detail will appear here.</p>
    </SceneDialog>
  );
}
