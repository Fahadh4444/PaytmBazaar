import Image from "next/image";

import styles from "./bazaar.module.css";

const PLATE = "/bazaar/sky-plate.webp";
const CLOUDS = "/bazaar/clouds.webp";

/**
 * The world under the clouds.
 *
 * Four image layers cut from one render (see scripts/build-landing-assets.py):
 * the city plate, a cloud deck split left/right so it can part, and a near
 * deck that frames the edges. Both files are pre-compressed WebP, so they are
 * served as-is rather than re-encoded.
 */
export default function BazaarEnvironment() {
  return (
    <>
      <div className={`${styles.layer} ${styles.plate}`}>
        <div className={`${styles.inner} ${styles.plateDrift}`}>
          <Image
            src={PLATE}
            alt="A marketplace city seen from above, half hidden beneath the clouds"
            fill
            sizes="100vw"
            preload
            unoptimized
          />
        </div>
      </div>

      <div className={`${styles.layer} ${styles.cloudLeft}`}>
        <div className={`${styles.inner} ${styles.driftLeft}`}>
          <Image src={CLOUDS} alt="" fill sizes="100vw" loading="eager" unoptimized />
        </div>
      </div>

      <div className={`${styles.layer} ${styles.cloudRight}`}>
        <div className={`${styles.inner} ${styles.driftRight}`}>
          <Image src={CLOUDS} alt="" fill sizes="100vw" loading="eager" unoptimized />
        </div>
      </div>

      <div className={`${styles.layer} ${styles.cloudNear}`}>
        <div className={`${styles.inner} ${styles.driftNear}`}>
          <Image src={CLOUDS} alt="" fill sizes="100vw" loading="eager" unoptimized />
        </div>
      </div>

      <div className={`${styles.layer} ${styles.wash}`} />
      <div className={`${styles.layer} ${styles.frame}`} />
    </>
  );
}
