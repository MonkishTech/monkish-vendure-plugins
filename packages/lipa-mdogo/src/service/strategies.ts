import { Order, RequestContext } from '@vendure/core';

export interface LipaMdogoPlanStrategy {
  minimumDue(deposit: number, settled: number, outstanding: number): number;
}

export const anyAmountUntilDeadline: LipaMdogoPlanStrategy = {
  minimumDue(deposit, settled, outstanding) {
    if (outstanding <= 0) {
      return 0;
    }
    const unpaid = deposit - settled;
    if (unpaid > 0) {
      return Math.min(unpaid, outstanding);
    }
    return Math.min(1, outstanding);
  },
};

export interface LipaMdogoMissedPaymentStrategy {
  handle(ctx: RequestContext, order: Order): Promise<void>;
}
