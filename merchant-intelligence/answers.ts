/**
 * Ask Bazaar without a language model: answers written by fixed rules from
 * the same fact table the model would have been given.
 *
 * The question picks a topic; the topic picks which facts to read and how to
 * word them. Every figure is copied from a fact, so a rule-written answer
 * passes exactly the same figure check as a model-written one, and says
 * nothing the engines did not calculate.
 *
 * This is the whole of Ask Bazaar in deterministic mode (see lib/mode.ts),
 * and it stays the safety net under the model in full mode.
 */

import type { Fact, ProposedAction } from "./types";

export type AnswerTopic =
  | "OVERVIEW"
  | "COMPARISON"
  | "TIME_OF_DAY"
  | "DAY_OF_WEEK"
  | "OFFER"
  | "ORDERS"
  | "REFUNDS"
  | "AVERAGE_BILL";

const TOPIC_PATTERNS: [AnswerTopic, RegExp][] = [
  [
    "OFFER",
    /offer|promotion|promo|cashback|discount|campaign|what (?:can|should) i do|what to do|recommend|suggest|advice|improve|increase|grow|boost|fix|help me/i,
  ],
  ["REFUNDS", /refund|return|cancel/i],
  ["AVERAGE_BILL", /average bill|bill size|basket|per order|per customer|aov/i],
  ["ORDERS", /order|customer|footfall|how many|transactions|demand/i],
  // "Time of day" names a slot; "my best day" names a weekday. The explicit
  // words decide first, so a question mentioning either is never mistaken.
  ["TIME_OF_DAY", /time of day|morning|afternoon|evening|night|hour/i],
  ["DAY_OF_WEEK", /weekend|weekday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\bdays?\b/i],
  [
    "COMPARISON",
    /compare|comparison|similar|others?|nearby|peers?|competition|competitors?|market|bazaar|city|behind|ahead|better than|worse than/i,
  ],
  // Said without naming a slot or a day: the times of day answer this best.
  ["TIME_OF_DAY", /quiet|busiest|busy|slow|weakest|strongest|peak/i],
];

/** The topic a question is about. Anything unrecognised gets the overview. */
export function detectTopic(question: string): AnswerTopic {
  for (const [topic, pattern] of TOPIC_PATTERNS) if (pattern.test(question)) return topic;
  return "OVERVIEW";
}

// --- Reading the facts ------------------------------------------------------------

type Read = (id: string) => number | null;

const money = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const pct = (n: number) => `${n > 0 ? "+" : ""}${n}%`;
/** "47.1 points behind": the sentence carries the direction, so the figure does not repeat it. */
const size = (n: number) => `${Math.abs(n)} points`;
const moved = (n: number) => (n > 0 ? `rose ${n}%` : n < 0 ? `fell ${Math.abs(n)}%` : "stayed level");
const SLOTS = ["morning", "afternoon", "evening", "night"] as const;
const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
const title = (word: string) => `${word[0].toUpperCase()}${word.slice(1)}`;

interface Segment {
  name: string;
  growth: number | null;
  share: number | null;
  cohort: number | null;
  ids: string[];
}

/** One row per time of day, or per weekday, from the pattern facts. */
function segments(read: Read, dimension: "timeOfDay" | "dayOfWeek"): Segment[] {
  const names = dimension === "timeOfDay" ? SLOTS : DAYS;
  return names
    .map((name) => {
      const key = `pattern.${dimension}.${name}`;
      return {
        name,
        growth: read(`${key}.merchant_growth`),
        share: read(`${key}.merchant_share`),
        cohort: read(`${key}.cohort_growth`),
        ids: [`${key}.merchant_growth`, `${key}.merchant_share`, `${key}.cohort_growth`],
      };
    })
    .filter((s) => s.growth !== null || s.share !== null);
}

const weakest = (rows: Segment[]) => rows.filter((s) => s.growth !== null).sort((a, b) => a.growth! - b.growth!)[0] ?? null;
const strongest = (rows: Segment[]) => rows.filter((s) => s.growth !== null).sort((a, b) => b.growth! - a.growth!)[0] ?? null;
const biggest = (rows: Segment[]) => rows.filter((s) => s.share !== null).sort((a, b) => b.share! - a.share!)[0] ?? null;

export interface DeterministicAnswer {
  answer: string;
  topic: AnswerTopic;
  /** IDs of the facts the answer used, in the order they appear. */
  factIds: string[];
}

const CAN_ANSWER = [
  "How are my sales doing?",
  "How do I compare with shops nearby?",
  "Which time of day is weakest for me?",
  "What is my strongest day?",
  "What offer would help most this week?",
];

/**
 * An answer to `question`, built from `facts`.
 *
 * `action` is the deterministic proposal (actions.ts) when there is one; it is
 * quoted as the suggestion so the chat and the offer card never disagree.
 */
export function answerFromFacts(question: string, facts: Fact[], action: ProposedAction | null = null): DeterministicAnswer {
  const read: Read = (id) => facts.find((f) => f.id === id)?.value ?? null;
  const used: string[] = [];
  const value = (id: string) => {
    const found = read(id);
    if (found !== null) used.push(id);
    return found;
  };
  const topic = detectTopic(question);

  const growth = value("merchant.gmv.growth");
  const cohort = value("cohort.gmv.growth");
  const lines: string[] = [];
  const add = (line: string | null) => {
    if (line) lines.push(`- ${line}`);
  };

  const headline =
    growth !== null && cohort !== null
      ? `Your sales ${moved(growth)} this week, while similar shops near you ${moved(cohort)}.`
      : growth !== null
        ? `Your sales ${moved(growth)} this week.`
        : "Here is what your sales data shows this week.";

  switch (topic) {
    case "COMPARISON": {
      const gap = value("gap.cohort");
      const peers = value("cohort.size");
      const bazaar = value("bazaar.gmv.growth");
      const city = value("city.gmv.growth");
      add(headline);
      if (gap !== null) add(`That puts you ${size(gap)} ${gap < 0 ? "behind" : "ahead of"} them${peers !== null ? `, out of ${peers} similar shops` : ""}.`);
      if (bazaar !== null) add(`Across your whole market, sales ${moved(bazaar)}.`);
      if (city !== null) add(`Across the city, sales ${moved(city)}.`);
      if (gap === null && cohort === null) add("There are not enough similar shops nearby to compare with this week.");
      break;
    }

    case "TIME_OF_DAY": {
      const rows = segments(read, "timeOfDay");
      if (rows.length === 0) {
        add(headline);
        add("Your sales are not split by time of day this week.");
        break;
      }
      const low = weakest(rows)!;
      const high = strongest(rows)!;
      const main = biggest(rows);
      used.push(...low.ids.filter((id) => read(id) !== null));
      add(`${title(low.name)} is your weakest time: sales there ${moved(low.growth!)}.`);
      if (low.cohort !== null && low.cohort > low.growth!) {
        add(`Similar shops ${moved(low.cohort)} in the same ${low.name}, so those customers are out there.`);
      }
      if (high !== low) {
        used.push(...high.ids.filter((id) => read(id) !== null));
        add(
          high.growth! >= 0
            ? `${title(high.name)} is your best time: sales there ${moved(high.growth!)}.`
            : `${title(high.name)} held up best: sales there ${moved(high.growth!)}.`,
        );
      }
      if (main?.share != null) {
        used.push(`pattern.timeOfDay.${main.name}.merchant_share`);
        add(`${title(main.name)} brings the most: ${main.share}% of your sales this week.`);
      }
      break;
    }

    case "DAY_OF_WEEK": {
      const rows = segments(read, "dayOfWeek");
      if (rows.length === 0) {
        add(headline);
        add("A week is too short to compare your days; each day appears only once.");
        break;
      }
      const high = strongest(rows)!;
      const low = weakest(rows)!;
      const main = biggest(rows);
      used.push(...high.ids.filter((id) => read(id) !== null), ...low.ids.filter((id) => read(id) !== null));
      add(
        high.growth! >= 0
          ? `${title(high.name)} is your strongest day: sales ${moved(high.growth!)}.`
          : `${title(high.name)} held up best: sales ${moved(high.growth!)}.`,
      );
      if (low !== high) add(`${title(low.name)} is your weakest: sales ${moved(low.growth!)}.`);
      if (main?.share != null) add(`${title(main.name)} brings ${main.share}% of your week's sales.`);
      break;
    }

    case "ORDERS": {
      const now = value("merchant.transactions.current");
      const before = value("merchant.transactions.previous");
      const demand = value("bazaar.demand.growth");
      if (now !== null && before !== null) add(`You had ${now} paid orders this week, against ${before} the week before.`);
      else add(headline);
      const aov = value("merchant.aov.current");
      if (aov !== null) add(`Your average bill was ${money(aov)}.`);
      if (demand !== null) add(`Orders across your market ${moved(demand)}, so the footfall around you is ${demand > 0 ? "growing" : demand < 0 ? "shrinking" : "flat"}.`);
      break;
    }

    case "AVERAGE_BILL": {
      const aov = value("merchant.aov.current");
      const gap = value("aov_gap.cohort");
      if (aov !== null) add(`Your average bill this week was ${money(aov)}.`);
      else add(headline);
      if (gap !== null) add(`That is ${pct(gap)} against similar shops near you.`);
      const orders = value("merchant.transactions.current");
      const gmv = value("merchant.gmv.current");
      if (gmv !== null && orders !== null) add(`It comes from ${money(gmv)} of sales across ${orders} paid orders.`);
      break;
    }

    case "REFUNDS": {
      const refunds = value("merchant.refunds.current");
      const gmv = value("merchant.gmv.current");
      if (refunds === null) add("No refunds are recorded for your shop this week.");
      else if (refunds === 0) add("You refunded nothing this week.");
      else add(`You refunded ${money(refunds)} this week${gmv !== null ? `, against ${money(gmv)} of sales` : ""}.`);
      add(headline);
      break;
    }

    case "OFFER": {
      add(headline);
      const gap = value("gap.cohort");
      if (gap !== null && gap < 0) add(`You are ${size(gap)} behind similar shops, so there is demand nearby you are not getting.`);
      const rows = segments(read, "timeOfDay");
      const low = weakest(rows);
      if (low?.growth != null) {
        used.push(`pattern.timeOfDay.${low.name}.merchant_growth`);
        add(`Your ${low.name} is the weakest part of the day: sales there ${moved(low.growth)}.`);
      }
      break;
    }

    case "OVERVIEW":
    default: {
      const gmv = value("merchant.gmv.current");
      const orders = value("merchant.transactions.current");
      const aov = value("merchant.aov.current");
      add(headline);
      if (gmv !== null && orders !== null) add(`You sold ${money(gmv)} from ${orders} paid orders.`);
      if (aov !== null) add(`Your average bill was ${money(aov)}.`);
      const gap = value("gap.cohort");
      if (gap !== null) add(`Against similar shops near you, you are ${size(gap)} ${gap < 0 ? "behind" : "ahead"}.`);
      break;
    }
  }

  // One suggestion, always the deterministic proposal when there is one.
  const rows = segments(read, "timeOfDay");
  const low = weakest(rows);
  const suggestion = action
    ? action.description
    : low?.growth != null && low.growth < 0
      ? `Try a small Paytm cashback in the ${low.name} to bring more customers in.`
      : "Keep doing what is working, and watch your quietest hours for a chance to grow.";

  const NEXT: Partial<Record<AnswerTopic, string>> = {
    COMPARISON: "Ask me which time of day is weakest for you, or what offer would help.",
    TIME_OF_DAY: "Ask me how you compare with shops nearby, or what offer would help.",
    DAY_OF_WEEK: "Ask me which time of day is weakest for you, or how you compare with shops nearby.",
    OFFER: "Ask me how you compare with shops nearby, or which time of day is weakest.",
    ORDERS: "Ask me how you compare with shops nearby, or which time of day is weakest.",
    AVERAGE_BILL: "Ask me how you compare with shops nearby, or which time of day is weakest.",
    REFUNDS: "Ask me how your sales are doing, or how you compare with shops nearby.",
  };
  const tail = NEXT[topic] ?? `You can also ask me: ${CAN_ANSWER.slice(1).join(" · ")}`;

  return {
    answer: [...lines, "", `**Try this:** ${suggestion}`, "", tail].join("\n"),
    topic,
    factIds: [...new Set(used)],
  };
}
