import {
  ActiveOrderService,
  OrderService,
  PaymentService,
  RequestContext,
  TransactionalConnection,
} from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import type { MpesaPaymentStatusBus } from '../payment-status/mpesa-payment-status-bus';
import type { ReversalCallbackPayload } from '../types';
import { MpesaService } from './mpesa.service';

const ctx = {} as RequestContext;

function reversalCallback(
  resultCode: string | number,
  originalTransactionId = 'UJRLKBJ8D8'
): ReversalCallbackPayload {
  return {
    Result: {
      ResultType: 0,
      ResultCode: resultCode,
      ResultDesc: 'The service request is processed successfully.',
      OriginatorConversationID: '3725-48f2-9c1b-092315249ab75572984',
      ConversationID: 'AG_20261027_010017761fdbpb8sum29',
      TransactionID: 'UJRLKR35B7',
      ResultParameters: {
        ResultParameter: [
          {
            Key: 'OriginalTransactionID',
            Value: originalTransactionId,
          },
        ],
      },
      ReferenceData: {
        ReferenceItem: {
          Key: 'QueueTimeoutURL',
          Value: 'https://example.test/reversal',
        },
      },
    },
  } as ReversalCallbackPayload;
}

function serviceFor(findOne: ReturnType<typeof vi.fn>) {
  const orderService = {
    settleRefund: vi.fn(),
    transitionRefundToState: vi.fn(),
  };
  const connection = {
    getRepository: () => ({ findOne }),
  };
  const service = new MpesaService(
    {} as ActiveOrderService,
    connection as unknown as TransactionalConnection,
    orderService as unknown as OrderService,
    {} as PaymentService,
    {} as MpesaPaymentStatusBus
  );
  return { service, orderService };
}

describe('MpesaService.handleReversalCallback', () => {
  it('settles the refund stored under OriginalTransactionID when Daraja sends ResultCode 0', async () => {
    const findOne = vi.fn(async ({ where }: { where: { transactionId: string } }) =>
      where.transactionId === 'UJRLKBJ8D8' ? { id: 'refund-1' } : null
    );
    const { service, orderService } = serviceFor(findOne);

    await service.handleReversalCallback(ctx, reversalCallback(0));

    expect(orderService.settleRefund).toHaveBeenCalledWith(ctx, {
      id: 'refund-1',
      transactionId: 'UJRLKR35B7',
    });
    expect(orderService.transitionRefundToState).not.toHaveBeenCalled();
  });

  it('settles when ResultCode is the string 0', async () => {
    const findOne = vi.fn(async () => ({ id: 'refund-1' }));
    const { service, orderService } = serviceFor(findOne);

    await service.handleReversalCallback(ctx, reversalCallback('0'));

    expect(findOne).toHaveBeenCalledWith({
      where: { transactionId: 'UJRLKBJ8D8' },
    });
    expect(orderService.settleRefund).toHaveBeenCalledOnce();
  });

  it('fails the matched refund when the reversal result is not success', async () => {
    const findOne = vi.fn(async () => ({ id: 'refund-1' }));
    const { service, orderService } = serviceFor(findOne);

    await service.handleReversalCallback(ctx, reversalCallback(1));

    expect(orderService.transitionRefundToState).toHaveBeenCalledWith(
      ctx,
      'refund-1',
      'Failed'
    );
    expect(orderService.settleRefund).not.toHaveBeenCalled();
  });

  it('does not settle when the original receipt is not on a refund', async () => {
    const findOne = vi.fn(async () => null);
    const { service, orderService } = serviceFor(findOne);

    await service.handleReversalCallback(ctx, reversalCallback(0));

    expect(findOne).toHaveBeenCalledWith({
      where: { transactionId: 'UJRLKBJ8D8' },
    });
    expect(orderService.settleRefund).not.toHaveBeenCalled();
  });
});
