/**
 * The M2M pipeline, end to end, producing one `M2MIntelligence` per merchant.
 *
 *   analyzeMerchant()        reads through a PaytmDataSource (the Data Adapter)
 *     └ buildM2MIntelligence()   pure: metrics → cohort → groups → context
 *                                → comparison → patterns → evidence
 *                                → Bazaar Impact → opportunities
 *
 * The engine depends on the `PaytmDataSource` interface only. The caller
 * supplies the implementation (`getPaytmDataSource()` in production, a fake in
 * tests), so the engine never touches Supabase.
 */

import { getRelevantCohort, cityMerchants, cityOf, type Network } from "./cohort";
import { compareWithNetwork } from "./comparison";
import { analyzeContext } from "./context";
import { buildEvidence } from "./evidence";
import {
  calculateBazaarMetrics,
  calculateCategoryMetrics,
  calculateCityMetrics,
  calculateCohortMetrics,
} from "./groups";
import { calculateBazaarImpact } from "./impact";
import { calculateMerchantMetrics } from "./metrics";
import { detectOpportunities } from "./opportunities";
import { detectPatterns } from "./patterns";
import { comparisonPeriod, eventWindow } from "./period";
import type {
  ComparisonPeriod,
  DataLimitation,
  DateRange,
  M2MIntelligence,
  Merchant,
  MerchantDailyMetric,
  PaymentEvent,
  PaytmDataSource,
} from "./types";

/** Everything the pure pipeline needs, already fetched. */
export interface M2MSnapshot extends Network {
  merchant: Merchant;
  dailyMetrics: MerchantDailyMetric[];
  /** Successful payments of the merchant and its cohort, covering both periods. */
  events: PaymentEvent[];
}

export function buildM2MIntelligence(snapshot: M2MSnapshot, period: ComparisonPeriod): M2MIntelligence {
  const { merchant, dailyMetrics: rows, events } = snapshot;
  const network: Network = { bazaars: snapshot.bazaars, merchants: snapshot.merchants };

  const merchantMetrics = calculateMerchantMetrics(merchant.mid, rows, period);
  const cohort = getRelevantCohort(merchant, network);
  const cohortMetrics = calculateCohortMetrics(cohort, rows, period);
  const categoryMetrics = calculateCategoryMetrics(merchant, network, rows, period);
  const bazaarMetrics = calculateBazaarMetrics(merchant, network, rows, period);
  const cityMetrics = calculateCityMetrics(merchant, network, rows, period);

  const context = analyzeContext(
    merchant.mid,
    cohort.reportable ? cohort.cohortMerchantIds : [],
    events,
    period,
  );
  const comparisons = compareWithNetwork(merchantMetrics, {
    cohort: cohortMetrics,
    bazaar: bazaarMetrics,
    city: cityMetrics,
  });
  const evidence = buildEvidence({
    merchant: merchantMetrics,
    cohort,
    cohortMetrics,
    bazaarMetrics,
    cityMetrics,
    period,
  });
  const patterns = detectPatterns({ comparisons, context, evidence });
  const bazaarImpact = calculateBazaarImpact({
    merchant: merchantMetrics,
    cohort: cohortMetrics,
    category: categoryMetrics,
    bazaar: bazaarMetrics,
    city: cityMetrics,
  });
  const opportunities = detectOpportunities({ patterns, impact: bazaarImpact, evidence });

  const limitations: DataLimitation[] = [];
  if (cohort.basis === "city_category") limitations.push("COHORT_FALLBACK_TO_CITY_CATEGORY");
  if (!cohort.reportable) limitations.push("COHORT_TOO_SMALL");
  if (!bazaarMetrics.reportable) limitations.push("BAZAAR_TOO_SMALL");
  if (!cityMetrics.reportable) limitations.push("CITY_TOO_SMALL");
  if (merchantMetrics.current.transactions === 0 && merchantMetrics.previous.transactions === 0) {
    limitations.push("NO_MERCHANT_ACTIVITY");
  }
  if (merchantMetrics.previous.gmv === 0) limitations.push("NO_PREVIOUS_PERIOD_GMV");

  return {
    merchantId: merchant.mid,
    bazaarId: merchant.bazaarId,
    city: cohort.city,
    category: merchant.category,
    period,
    // Shape only: the output never names or identifies cohort members.
    cohort: { basis: cohort.basis, category: cohort.category, size: cohort.cohortSize, reportable: cohort.reportable },
    merchantMetrics,
    cohortMetrics,
    categoryMetrics,
    bazaarMetrics,
    cityMetrics,
    comparisons,
    context,
    patterns,
    evidence,
    bazaarImpact,
    opportunities,
    limitations,
  };
}

export interface AnalyzeMerchantInput {
  merchantId: string;
  /** The period to analyse, inclusive IST business dates. */
  current: DateRange;
  /** Defaults to the equally long period immediately before `current`. */
  previous?: DateRange;
}

/**
 * Reads what one merchant's analysis needs through the Data Adapter, then
 * runs the pure pipeline. Adapter errors (e.g. `NotFoundError`) propagate.
 */
export async function analyzeMerchant(
  source: PaytmDataSource,
  input: AnalyzeMerchantInput,
): Promise<M2MIntelligence> {
  const period = comparisonPeriod(input.current, input.previous);

  const [merchant, bazaars, merchants] = await Promise.all([
    source.getMerchant(input.merchantId),
    source.getBazaars(),
    source.getMerchants(),
  ]);
  const network: Network = { bazaars, merchants };
  const cityMids = cityMerchants(cityOf(merchant.bazaarId, bazaars), network).map((m) => m.mid);
  const cohort = getRelevantCohort(merchant, network);

  const [dailyMetrics, events] = await Promise.all([
    source.getDailyMetricsForMerchants(cityMids, { from: period.previous.from, to: period.current.to }),
    source.getTransactionsForMerchants([merchant.mid, ...(cohort.reportable ? cohort.cohortMerchantIds : [])], {
      range: eventWindow(period),
      transactionType: "ACQUIRING",
      status: "TXN_SUCCESS",
    }),
  ]);

  return buildM2MIntelligence({ ...network, merchant, dailyMetrics, events }, period);
}
