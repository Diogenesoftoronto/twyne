import { hasCurrentTwynePlan } from "./subscription-plan";

export type CheckoutReturnStatus =
  | "checking"
  | "pro-active"
  | "pending"
  | "unavailable";

const MAX_ATTEMPTS = 5;
const REFRESH_INTERVAL_MS = 3_000;
const REFRESH_DEADLINE_MS = 15_000;

/** The return URL is a refresh hint; it never supplies payment authority. */
export function isCheckoutReturn(search: string): boolean {
  const values = new URLSearchParams(search).getAll("checkout");
  return values.length === 1 && values[0] === "success";
}

type Schedule = (callback: () => void, delayMs: number) => () => void;

function scheduleTimeout(callback: () => void, delayMs: number): () => void {
  const timer = setTimeout(callback, delayMs);
  return () => clearTimeout(timer);
}

/**
 * Refresh only authenticated wallet reads, with no overlapping requests.
 * A current Pro plan confirms entitlement, not this checkout's payment or a
 * credit purchase. Receipts and payment status remain in Not Organic.
 */
export function refreshCheckoutReturnWallet(options: {
  readWallet: () => Promise<unknown>;
  isCurrent: () => boolean;
  onWallet: (wallet: unknown) => void;
  onStatus: (status: CheckoutReturnStatus) => void;
  schedule?: Schedule;
}): () => void {
  const schedule = options.schedule ?? scheduleTimeout;
  let stopped = false;
  let attempts = 0;
  let cancelRefresh = () => {};
  let cancelDeadline = () => {};

  const stop = () => {
    stopped = true;
    cancelRefresh();
    cancelDeadline();
  };
  const isCurrent = () => !stopped && options.isCurrent();
  const finish = (status: CheckoutReturnStatus) => {
    const publish = isCurrent();
    stop();
    if (publish) options.onStatus(status);
  };

  const refresh = async () => {
    if (!isCurrent()) {
      stop();
      return;
    }
    attempts++;
    try {
      const wallet = await options.readWallet();
      if (!isCurrent()) {
        stop();
        return;
      }
      options.onWallet(wallet);
      if (hasCurrentTwynePlan(wallet)) {
        finish("pro-active");
      } else if (attempts >= MAX_ATTEMPTS) {
        finish("pending");
      } else {
        cancelRefresh = schedule(() => void refresh(), REFRESH_INTERVAL_MS);
      }
    } catch {
      finish("unavailable");
    }
  };

  if (isCurrent()) {
    options.onStatus("checking");
    cancelDeadline = schedule(() => finish("pending"), REFRESH_DEADLINE_MS);
    void refresh();
  }
  return stop;
}
