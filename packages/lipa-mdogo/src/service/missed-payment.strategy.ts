import { Injectable } from '@nestjs/common';
import {
  isGraphQlErrorResult,
  Order,
  OrderService,
  OrderStateTransitionError,
  PaymentService,
  RequestContext,
} from '@vendure/core';

import { LipaMdogoMissedPaymentStrategy } from './strategies';

@Injectable()
export class RefundSettledPaymentsStrategy
  implements LipaMdogoMissedPaymentStrategy
{
  constructor(
    private orderService: OrderService,
    private paymentService: PaymentService
  ) {}

  async handle(ctx: RequestContext, order: Order): Promise<void> {
    for (const payment of order.payments ?? []) {
      if (payment.state !== 'Settled') {
        continue;
      }
      const recorded = (payment.refunds ?? [])
        .filter((refund) => refund.state !== 'Failed')
        .reduce((sum, refund) => sum + refund.total, 0);
      const refundable = payment.amount - recorded;
      if (refundable <= 0) {
        continue;
      }
      // refundOrder rejects ArrangingPayment, which is still the state of a missed plan.
      const result = await this.paymentService.createRefund(
        ctx,
        {
          paymentId: payment.id,
          amount: refundable,
          shipping: 0,
          adjustment: 0,
        },
        order,
        payment
      );
      if (isGraphQlErrorResult(result)) {
        throw new Error(result.message);
      }
    }
    if (order.state === 'Cancelled') {
      return;
    }
    const transitioned = await this.orderService.transitionToState(
      ctx,
      order.id,
      'Cancelled'
    );
    if (transitioned instanceof OrderStateTransitionError) {
      throw new Error(transitioned.message);
    }
  }
}
