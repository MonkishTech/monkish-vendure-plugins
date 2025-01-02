import {
  CreatePaymentResult,
  CreateRefundResult,
  Injector,
  LanguageCode,
  PaymentMethodHandler,
  SettlePaymentResult,
} from '@vendure/core';
import { PaystackService } from 'src/service/paystack.service';

let paystackService: PaystackService;

export const paystackPaymentMethodHandler = new PaymentMethodHandler({
  code: 'paystack',

  description: [{ languageCode: LanguageCode.en, value: 'Paystack payments' }],

  args: {},

  init(injector: Injector) {
    paystackService = injector.get(PaystackService);
  },

  createPayment(ctx, _order, amount, _args, metadata): CreatePaymentResult {
    // Payment is already settled in Paystack by the time the webhook in paystack.controller.ts
    // adds the payment to the order
    if (ctx.apiType !== 'admin') {
      throw Error(`CreatePayment is not allowed for apiType '${ctx.apiType}'`);
    }

    return {
      amount,
      state: 'Settled' as const,
      transactionId: metadata.transactionId,
    };
  },

  settlePayment(): SettlePaymentResult {
    return {
      success: true,
    };
  },

  async createRefund(
    _ctx,
    input,
    _amount,
    order,
    payment
  ): Promise<CreateRefundResult> {
    return paystackService.createRefund(input, order, payment);
  },
});
