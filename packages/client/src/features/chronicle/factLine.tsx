import {
  ArrowLeftRight,
  Coins,
  Crown,
  Flag,
  Handshake,
  Landmark,
  MapPin,
  ScrollText,
  Shield,
  Sparkles,
  Swords,
  Unlink,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "../../components/Badge.tsx";
import { parseDigestLine, type FactCategory } from "../../lib/factLine.ts";
import styles from "./chronicle.module.css";

type Tone = "neutral" | "danger" | "success";

const CATEGORIES: Record<FactCategory, { icon: LucideIcon; tone: Tone }> = {
  war_started: { icon: Swords, tone: "danger" },
  war_ended: { icon: Flag, tone: "success" },
  treaty: { icon: ScrollText, tone: "success" },
  treaty_broken: { icon: Unlink, tone: "danger" },
  leader: { icon: Crown, tone: "neutral" },
  government: { icon: Landmark, tone: "neutral" },
  economy: { icon: Coins, tone: "neutral" },
  relations: { icon: ArrowLeftRight, tone: "neutral" },
  arc: { icon: Waypoints, tone: "neutral" },
  commitment: { icon: Handshake, tone: "neutral" },
  notable: { icon: Sparkles, tone: "neutral" },
  territory: { icon: MapPin, tone: "neutral" },
  polity: { icon: Shield, tone: "neutral" },
};

const TONE_CLASS: Record<Tone, string | undefined> = {
  neutral: undefined,
  danger: styles.factDanger,
  success: styles.factSuccess,
};

/**
 * One digest line, with its "(reported)"/"(rumor)" head lifted into a badge
 * and its category token into a labelled icon. The prefix is the engine's
 * wire format — keep the words, only style them.
 */
export function FactLine({ line }: { line: string }) {
  const { confidence, category, body } = parseDigestLine(line);
  const meta = category ? CATEGORIES[category] : undefined;
  const Icon = meta?.icon ?? Sparkles;
  return (
    <li className={[styles.fact, meta ? TONE_CLASS[meta.tone] : undefined].filter(Boolean).join(" ")}>
      <Icon size={13} className={styles.factIcon} aria-hidden />
      <span className={styles.factText}>
        {category ? <span className={styles.factCategory}>{category.replace("_", " ")}</span> : null}
        {/* Intel marks: how well the court actually knows the line it is
            reading. Confirmed facts carry no badge at all — certainty is the
            quiet default. */}
        {confidence ? (
          <Badge tone={confidence === "rumor" ? "warning" : "info"}>{confidence}</Badge>
        ) : null}{" "}
        {body.replaceAll("->", " → ")}
      </span>
    </li>
  );
}
