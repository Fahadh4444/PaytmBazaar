/**
 * Errors raised by the Paytm data source.
 *
 * Callers catch `PaytmDataError` and branch on `code`. They never see a raw
 * Supabase or PostgREST error. When one causes a failure, it is kept as
 * `cause` for logs only.
 */

export type PaytmDataErrorCode =
  | "not_found"
  | "invalid_query"
  | "result_too_large"
  | "unavailable";

export class PaytmDataError extends Error {
  constructor(
    message: string,
    readonly code: PaytmDataErrorCode,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "PaytmDataError";
  }
}

export type PaytmEntity = "bazaar" | "merchant";

/** A bazaar or merchant that was asked for by ID does not exist. */
export class NotFoundError extends PaytmDataError {
  constructor(
    readonly entity: PaytmEntity,
    readonly ids: string[],
  ) {
    super(`${entity === "bazaar" ? "Bazaar" : "Merchant"} not found: ${ids.join(", ")}.`, "not_found");
    this.name = "NotFoundError";
  }
}

/** The request itself is malformed, for example a reversed date range or a blank ID. */
export class InvalidQueryError extends PaytmDataError {
  constructor(message: string) {
    super(message, "invalid_query");
    this.name = "InvalidQueryError";
  }
}

/** A query without a page matched more rows than the adapter will read in one call. */
export class ResultTooLargeError extends PaytmDataError {
  constructor(readonly maxRows: number) {
    super(
      `Query matched more than ${maxRows} rows. Narrow the range or scope, or request a page.`,
      "result_too_large",
    );
    this.name = "ResultTooLargeError";
  }
}

/** The underlying store is unreachable, unconfigured, or rejected the query. */
export class DataSourceError extends PaytmDataError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, "unavailable", options);
    this.name = "DataSourceError";
  }
}
