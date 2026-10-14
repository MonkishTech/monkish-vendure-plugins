import { Order, RequestContext } from '@vendure/core';

export interface LipaMdogoPlanStrategy {
  minimumDue(minimumPayment: number, outstanding: number): number;
}

export const anyAmountUntilDeadline: LipaMdogoPlanStrategy = {
  minimumDue(minimumPayment, outstanding) {
    return Math.min(minimumPayment, outstanding);
  },
};

export interface LipaMdogoMissedPaymentStrategy {
  handle(ctx: RequestContext, order: Order): Promise<void>;
}
