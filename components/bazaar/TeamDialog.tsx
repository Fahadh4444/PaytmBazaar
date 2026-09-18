"use client";

import SceneDialog from "./SceneDialog";
import styles from "./dialog.module.css";

const TEAM = [
  { name: "Shanti Appari", email: "shanthiappari@gmail.com" },
  { name: "Fahadh Kasala", email: "mdfahadh2000@gmail.com" },
];

type TeamDialogProps = {
  open: boolean;
  onClose: () => void;
};

export default function TeamDialog({ open, onClose }: TeamDialogProps) {
  return (
    <SceneDialog open={open} onClose={onClose} eyebrow="Paytm Bazaar" title="Our Team">
      <hr className={styles.rule} />

      <p className={styles.org}>FinWays</p>

      <ul className={styles.people}>
        {TEAM.map((member) => (
          <li key={member.email} className={styles.person}>
            <span className={styles.personName}>{member.name}</span>
            <a className={styles.personMail} href={`mailto:${member.email}`}>
              {member.email}
            </a>
          </li>
        ))}
      </ul>
    </SceneDialog>
  );
}
