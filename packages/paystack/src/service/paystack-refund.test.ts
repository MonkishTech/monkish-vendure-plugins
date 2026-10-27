import {
  ActiveOrderService,
  ConfigService,
  Order,
  OrderService,
  Payment,
  PaymentMethodService,
  PaymentService,
  RequestContext,
  RequestContextService,
  TransactionalConnection,
} from '@vendure/core';
import nock from 'nock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PAYSTACK_API_URL } from '../constants';
import { RefundEvent } from '../types';
import { PaystackService } from './paystack.service';

const ctx = {} as RequestContext;

function refundEvent(
  event: RefundEvent['event'],
  id: string | number = '18878480'
): RefundEvent {
  return {
    event,
    data: {
      id,
      status: 'pending',
      transaction_reference: 'T725658222844357',
      refund_reference: null,
      amount: '2000',
      currency: 'KES',
      processor: 'test',
      customer: { first_name: '', last_name: '', email: 'buyer@example.com' },
      integration: 1,
      domain: 'test',
    },
  };
}

function serviceFor(findOne = vi.fn(async () => null)) {
  const transitionRefundToState = vi.fn();
  const connection = {
    withTransaction: async (
      _outer: RequestContext,
      work: (inner: RequestContext) => Promise<void>
    ) => work(ctx),
    getRepository: () => ({ findOne }),
  };
  const service = new PaystackService(
    {} as ActiveOrderService,
    {} as ConfigService,
    connection as unknown as TransactionalConnection,
    { transitionRefundToState } as unknown as OrderService,
    {
      findAll: async () => ({
        items: [
          {
            code: 'paystack',
            handler: {
              code: 'paystack',
              args: [{ name: 'secretKey', value: 'sk_test' }],
            },
          },
        ],
      }),
    } as unknown as PaymentMethodService,
    {} as PaymentService,
    { create: async () => ctx } as unknown as RequestContextService
  );
  return { service, transitionRefundToState };
}

const order = { code: 'ORDER1' } as Order;
const payment = {
  method: 'paystack',
  transactionId: '6666860274',
} as Payment;

describe('PaystackService.createRefund', () => {
  beforeEach(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('returns Validating under the Paystack refund id when Paystack accepts a pending refund', async () => {
    let sent: unknown;
    const scope = nock(PAYSTACK_API_URL)
      .post('/refund', (body) => {
        sent = body;
        return true;
      })
      .reply(200, {
        status: true,
        message: 'Refund has been queued for processing',
        data: {
          id: 18878480,
          status: 'pending',
          transaction: { reference: 'T725658222844357' },
        },
      });
    const { service } = serviceFor();

    const result = await service.createRefund(
      ctx,
      { amount: 2000, reason: 'Organiser void' } as never,
      order,
      payment
    );

    expect(scope.isDone()).toBe(true);
    expect(sent).toEqual({
      transaction: '6666860274',
      amount: 2000,
      merchant_note: 'Organiser void',
    });
    expect(result).toEqual({
      state: 'Validating',
      transactionId: '18878480',
      metadata: {
        public: {
          reference: 'T725658222844357',
          paystackRefundId: '18878480',
        },
      },
    });
  });

  it('returns Failed when Paystack reports the refund as failed', async () => {
    nock(PAYSTACK_API_URL).post('/refund').reply(200, {
      status: true,
      message: 'Refund failed',
      data: { id: 18878480, status: 'failed' },
    });
    const { service } = serviceFor();

    const result = await service.createRefund(
      ctx,
      { amount: 2000, reason: 'Organiser void' } as never,
      order,
      payment
    );

    expect(result.state).toBe('Failed');
    expect(result.transactionId).toBe('6666860274');
  });

  it('returns Failed when Paystack accepts the call without a refund id', async () => {
    nock(PAYSTACK_API_URL).post('/refund').reply(200, {
      status: true,
      message: 'ok',
      data: { status: 'pending' },
    });
    const { service } = serviceFor();

    const result = await service.createRefund(
      ctx,
      { amount: 2000, reason: 'Organiser void' } as never,
      order,
      payment
    );

    expect(result.state).toBe('Failed');
  });
});

describe('PaystackService.handleRefundEvent', () => {
  it('settles the Validating refund with this Paystack refund id', async () => {
    const findOne = vi.fn(async ({ where }: { where: { transactionId: string } }) =>
      where.transactionId === '18878480'
        ? { id: 'refund-1', state: 'Validating' }
        : null
    );
    const { service, transitionRefundToState } = serviceFor(findOne);

    await service.handleRefundEvent(refundEvent('refund.processed'));

    expect(transitionRefundToState).toHaveBeenCalledWith(ctx, 'refund-1', 'Settled');
  });

  it('fails the Validating refund when Paystack reports refund.failed', async () => {
    const findOne = vi.fn(async () => ({ id: 'refund-1', state: 'Validating' }));
    const { service, transitionRefundToState } = serviceFor(findOne);

    await service.handleRefundEvent(refundEvent('refund.failed'));

    expect(transitionRefundToState).toHaveBeenCalledWith(ctx, 'refund-1', 'Failed');
  });

  it('leaves a Validating refund unchanged for refund.pending and refund.processing', async () => {
    const findOne = vi.fn(async () => ({ id: 'refund-1', state: 'Validating' }));
    const { service, transitionRefundToState } = serviceFor(findOne);

    await service.handleRefundEvent(refundEvent('refund.pending'));
    await service.handleRefundEvent(refundEvent('refund.processing'));

    expect(transitionRefundToState).not.toHaveBeenCalled();
  });

  it('does not move a refund that is already Settled or Failed', async () => {
    const findOne = vi
      .fn()
      .mockResolvedValueOnce({ id: 'refund-1', state: 'Settled' })
      .mockResolvedValueOnce({ id: 'refund-1', state: 'Failed' });
    const { service, transitionRefundToState } = serviceFor(findOne);

    await service.handleRefundEvent(refundEvent('refund.processed'));
    await service.handleRefundEvent(refundEvent('refund.failed'));

    expect(transitionRefundToState).not.toHaveBeenCalled();
  });

  it('does not settle a different refund on the same charge', async () => {
    const findOne = vi.fn(async ({ where }: { where: { transactionId: string } }) =>
      where.transactionId === '999' ? { id: 'other', state: 'Validating' } : null
    );
    const { service, transitionRefundToState } = serviceFor(findOne);

    await service.handleRefundEvent(refundEvent('refund.processed', '18878480'));

    expect(transitionRefundToState).not.toHaveBeenCalled();
  });
});
