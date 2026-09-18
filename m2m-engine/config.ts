/**
 * Every threshold the engine uses, in one place, so the rules stay visible
 * and tunable rather than scattered as magic numbers.
 */

/**
 * Smallest number of merchants a group may contain before any aggregate
 * derived from it may be shown to a merchant. The merchant receiving the
 * result never counts towards it.
 *
 * Below this size an "aggregate" can be reverse-engineered into a single
 * merchant's private figures, which is exactly what Bazaar must never do.
 */
export const MIN_COHORT_SIZE = 5;

export const M2M_THRESHOLDS = {
  /** Growth within ±this many percent counts as flat, not up or down. */
  flatGrowthPct: 2,
  /** Merchant and cohort "align" when they move the same way within this many points. */
  alignmentTolerancePp: 5,
  /** A merchant-vs-network gap at least this wide (in points) is an opportunity. */
  opportunityGapPp: 10,
  /** Gap (in points) at which an opportunity becomes medium, then high priority. */
  mediumPriorityGapPp: 15,
  highPriorityGapPp: 25,
  /** Fewest merchant transactions in a context segment, in each period, to judge it. */
  minSegmentTransactions: 20,
  /**
   * Shortest period in which day-of-week patterns are reported. Below two
   * weeks each weekday occurs once, so a "Saturday" trend is one day vs one day.
   */
  minDaysForDayOfWeekPatterns: 14,
  /** Most context patterns reported, strongest first, to keep output focused. */
  maxContextPatterns: 3,
} as const;

/** Business dates and hours are in India Standard Time (UTC+05:30), as in the database view. */
export const IST_OFFSET_MINUTES = 330;
