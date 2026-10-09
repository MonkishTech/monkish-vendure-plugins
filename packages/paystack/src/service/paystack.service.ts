import { Injectable } from '@nestjs/common';
import {
  ConfigurableOperation,
  RefundOrderInput,
} from '@vendure/common/lib/generated-types';
import {
  ActiveOrderService,
  ConfigService,
  CreateRefundResult,
  InternalServerError,
  isGraphQlErrorResult,
  LanguageCode,
  Logger,
  Order,
  OrderService,
  OrderStateTransitionError,
  Payment,
  PaymentMethod,
  PaymentMethodService,
  PaymentService,
  RequestContext,
  RequestContextService,
  TransactionalConnection,
  UserInputError,
} from '@vendure/core';
import axios, { AxiosError, AxiosInstance } from 'axios';
import { paystackPaymentMethodHandler } from '../config/paystack.handler';
import {
  CHARGE_AMOUNT_METADATA_KEY,
  loggerCtx,
  PAYSTACK_API_URL,
  PAYSTACK_ORDER_CODE_METADATA_KEY,
  SETTLEMENT_AMOUNT_METADATA_KEY,
  SUPPORTED_CURRENCICES,
} from '../constants';
import {
  ErrorCode,
  PaystackPaymentIntent,
  PaystackPaymentIntentError,
  PaystackPaymentIntentInput,
  PaystackPaymentIntentResult,
  RefundEvent,
  RefundResponse,
  TransactionEvent,
  VerificationResponse,
} from '../types';

export class PaystackSettleRejection extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaystackSettleRejection';
  }
}

function orderCodeFromMetadata(
  metadata: Record<string, unknown> | null
): string | undefined {
  const value = metadata?.[PAYSTACK_ORDER_CODE_METADATA_KEY];
  return typeof value === 'string' ? value : undefined;
}

function numberFromMetadata(
  metadata: Record<string, unknown> | null,
  key: string
): number | undefined {
  const value = metadata?.[key];
  return typeof value === 'number' ? value : undefined;
}

function outstandingBalance(order: Order): number {
  const covered = (order.payments ?? [])
    .filter((payment) => payment.state === 'Settled')
    .reduce((sum, payment) => sum + payment.amount, 0);
  return order.totalWithTax - covered;
}

function resolvePaystackAmounts(
  input: PaystackPaymentIntentInput,
  outstanding: number
): { chargeAmount: number; settlementAmount?: number } | PaymentIntentError {
  const { chargeAmount, paystackAmount, settlementAmount } = input;
  if (
    chargeAmount != null &&
    paystackAmount != null &&
    chargeAmount !== paystackAmount
  ) {
    return new PaymentIntentError(
      'chargeAmount and paystackAmount must match.'
    );
  }
  if (settlementAmount != null) {
    if (!Number.isInteger(settlementAmount) || settlementAmount <= 0) {
      return new PaymentIntentError(
        'settlementAmount must be a positive integer.'
      );
    }
    if (settlementAmount > outstanding) {
      return new PaymentIntentError(
        'settlementAmount cannot exceed the outstanding balance.'
      );
    }
  }
  const settlement = settlementAmount ?? outstanding;
  const charge = chargeAmount ?? paystackAmount ?? settlement;
  if (!Number.isInteger(charge) || charge <= 0) {
    return new PaymentIntentError('chargeAmount must be a positive integer.');
  }
  if (charge < settlement) {
    return new PaymentIntentError(
      'chargeAmount cannot be less than the settlement amount.'
    );
  }
  return {
    chargeAmount: charge,
    settlementAmount: settlementAmount == null ? undefined : settlementAmount,
  };
}

class PaymentIntentError implements PaystackPaymentIntentError {
  __typename = 'PaystackPaymentIntentError' as const;
  errorCode: ErrorCode = 'ORDER_PAYMENT_STATE_ERROR';

  constructor(public message: string) {}
}

function secretKeyFromHandler(
  handler: Pick<ConfigurableOperation, 'args'>
): string | undefined {
  const arg = handler.args.find((a) => a.name === 'secretKey');
  const v = arg?.value?.trim();
  return v || undefined;
}

@Injectable()
export class PaystackService {
  constructor(
    private activeOrderService: ActiveOrderService,
    private configService: ConfigService,
    private connection: TransactionalConnection,
    private orderService: OrderService,
    private paymentMethodService: PaymentMethodService,
    private paymentService: PaymentService,
    private requestContextService: RequestContextService
  ) {}

  private createPaystackClient(secretKey: string): AxiosInstance {
    return axios.create({
      baseURL: PAYSTACK_API_URL,
      headers: {
        Authorization: `Bearer ${secretKey}`,
      },
      validateStatus: (status: number) => status < 500,
    });
  }

  async getPaystackWebhookSecretKey(): Promise<string | null> {
    const ctx = await this.createContext();
    const paymentMethod = await this.getConfiguredPaymentMethod(ctx);
    return secretKeyFromHandler(paymentMethod.handler) ?? null;
  }

  private async listPaystackPaymentMethods(
    ctx: RequestContext
  ): Promise<PaymentMethod[]> {
    return (await this.paymentMethodService.findAll(ctx)).items.filter(
      (m) => m.handler.code === paystackPaymentMethodHandler.code
    );
  }

  private async getConfiguredPaymentMethod(
    ctx: RequestContext
  ): Promise<PaymentMethod> {
    const methods = await this.listPaystackPaymentMethods(ctx);

    if (methods.length === 0) {
      throw new UserInputError(
        'No Paystack payment method is configured for this channel.'
      );
    }

    if (methods.length > 1) {
      Logger.warn(
        'Multiple Paystack payment methods detected; using the first configured method.',
        loggerCtx
      );
    }

    const only = methods[0];
    if (!only) {
      throw new InternalServerError(`[${loggerCtx}] No Paystack payment method`);
    }
    return only;
  }

  async initializeTransaction(
    ctx: RequestContext,
    input: PaystackPaymentIntentInput
  ): Promise<PaystackPaymentIntentResult> {
    const sessionOrder = await this.activeOrderService.getActiveOrder(
      ctx,
      undefined
    );
    if (!sessionOrder) {
      throw new UserInputError('No active order found for session');
    }

    const order = await this.orderService.findOne(ctx, sessionOrder.id, [
      'customer',
      'payments',
    ]);
    if (!order) {
      throw new UserInputError('No order found for active session');
    }

    const {
      channels,
      callbackUrl,
      metadata,
    } = input;
    const { customer, currencyCode, code } = order;

    if (!customer) {
      throw new UserInputError('No customer found for active order');
    }

    if (!SUPPORTED_CURRENCICES.includes(currencyCode)) {
      return new PaymentIntentError(`
        Currency code ${currencyCode} is not supported by Paystack. 
        Supported currencies are: ${SUPPORTED_CURRENCICES.join(', ')}
      `);
    }

    const paymentMethod = await this.getConfiguredPaymentMethod(ctx);
    const secretKey = secretKeyFromHandler(paymentMethod.handler);
    if (!secretKey) {
      throw new InternalServerError(
        `[${loggerCtx}] Paystack payment method "${paymentMethod.code}" has no secret key configured.`
      );
    }

    const resolved = resolvePaystackAmounts(input, outstandingBalance(order));
    if (resolved instanceof PaymentIntentError) {
      return resolved;
    }

    const userMeta =
      metadata &&
      typeof metadata === 'object' &&
      !Array.isArray(metadata) &&
      metadata !== null
        ? (metadata as Record<string, unknown>)
        : {};
    const mergedMetadata = {
      ...userMeta,
      [PAYSTACK_ORDER_CODE_METADATA_KEY]: code,
      [CHARGE_AMOUNT_METADATA_KEY]: resolved.chargeAmount,
      ...(resolved.settlementAmount != null
        ? { [SETTLEMENT_AMOUNT_METADATA_KEY]: resolved.settlementAmount }
        : {}),
    };

    try {
      const client = this.createPaystackClient(secretKey);
      const { data, status } = await client.post<PaystackPaymentIntent>(
        '/transaction/initialize',
        {
          amount: resolved.chargeAmount,
          email: customer.emailAddress,
          currency: currencyCode,
          callback_url: callbackUrl,
          metadata: mergedMetadata,
          channels,
        }
      );

      if (status !== 200) {
        return new PaymentIntentError(data.message);
      }

      return data;
    } catch (error) {
      Logger.error(
        JSON.stringify((error as AxiosError).toJSON(), null, 2),
        loggerCtx
      );
      return new PaymentIntentError(
        "Couldn't initialize transaction. Please try again"
      );
    }
  }

  async verifyTransaction(
    secretKey: string,
    transactionReference: string
  ): Promise<
    | {
        id: number;
        amount: number;
        metadata: Record<string, unknown> | null;
      }
    | undefined
  > {
    const client = this.createPaystackClient(secretKey);
    try {
      const {
        data: { data },
        status,
      } = await client.get<VerificationResponse>(
        `/transaction/verify/${transactionReference}`
      );
      if (status !== 200 || data.status !== 'success') {
        return undefined;
      }
      return {
        id: data.id,
        amount: data.amount,
        metadata:
          data.metadata && typeof data.metadata === 'object'
            ? (data.metadata as Record<string, unknown>)
            : null,
      };
    } catch (error) {
      Logger.error(
        `Could not verify transaction with reference: ${transactionReference}`,
        loggerCtx
      );
      Logger.error(
        JSON.stringify((error as AxiosError).toJSON(), null, 2),
        loggerCtx
      );
      return undefined;
    }
  }

  async createRefund(
    ctx: RequestContext,
    input: RefundOrderInput,
    order: Order,
    payment: Payment
  ): Promise<CreateRefundResult> {
    const paymentMethod = await this.getConfiguredPaymentMethod(ctx);
    if (payment.method !== paymentMethod.code) {
      Logger.error(
        `[${loggerCtx}] Refund failed: payment method ${payment.method} does not match configured Paystack method ${paymentMethod.code}`,
        loggerCtx
      );
      return {
        state: 'Failed' as const,
        transactionId: payment.metadata.public.transactionId,
      };
    }
    const secretKey = secretKeyFromHandler(paymentMethod.handler);
    if (!secretKey) {
      Logger.error(
        `[${loggerCtx}] Refund failed: no secret key on payment method ${paymentMethod.code}`,
        loggerCtx
      );
      return {
        state: 'Failed' as const,
        transactionId: payment.metadata.public.transactionId,
      };
    }

    const client = this.createPaystackClient(secretKey);

    try {
      const { reason } = input;

      const {
        data: { data },
        status,
      } = await client.post<RefundResponse>('/refund', {
        transaction: order.code,
        amount: input.amount,
        merchant_note: reason,
      });

      if (status !== 200) {
        Logger.error(
          `Could not refund transaction with ID ${payment.metadata.public.transactionId} for order ${order.code}`,
          loggerCtx
        );

        return {
          state: 'Failed' as const,
          transactionId: payment.metadata.public.transactionId,
        };
      }

      return {
        state: 'Pending' as const,
        transactionId: payment.metadata.public.transactionId,
        metadata: {
          public: {
            reference: data.transaction.reference,
          },
        },
      };
    } catch (error) {
      Logger.error(
        `Could not refund transaction with reference: ${order.code}`,
        loggerCtx
      );
      Logger.error(
        JSON.stringify((error as AxiosError).toJSON(), null, 2),
        loggerCtx
      );

      return {
        state: 'Failed' as const,
        transactionId: payment.metadata.public.transactionId,
      };
    }
  }

  async handleSuccessfulCharge(
    event: TransactionEvent,
    webhookSecretKey: string
  ): Promise<void> {
    const verified = await this.verifyTransaction(
      webhookSecretKey,
      event.data.reference
    );
    if (!verified) {
      throw new PaystackSettleRejection('Paystack payment was not successful');
    }
    const outerCtx = await this.createContext();
    await this.connection.withTransaction(outerCtx, async (ctx) => {
      await this.settleVerifiedCharge(ctx, verified);
    });
  }

  async confirmPayment(ctx: RequestContext, reference: string): Promise<Order> {
    const trimmed = reference.trim();
    if (!trimmed) {
      throw new UserInputError('Payment reference is required');
    }
    const sessionOrder = await this.activeOrderService.getActiveOrder(
      ctx,
      undefined
    );
    const paymentMethod = await this.getConfiguredPaymentMethod(ctx);
    const secretKey = secretKeyFromHandler(paymentMethod.handler);
    if (!secretKey) {
      throw new InternalServerError(
        `[${loggerCtx}] Paystack payment method "${paymentMethod.code}" has no secret key configured.`
      );
    }
    const verified = await this.verifyTransaction(secretKey, trimmed);
    if (!verified) {
      throw new UserInputError('Paystack payment was not successful');
    }
    const orderCode = orderCodeFromMetadata(verified.metadata);
    if (sessionOrder) {
      if (orderCode !== sessionOrder.code) {
        throw new UserInputError('Payment reference does not match this order');
      }
    } else {
      if (!orderCode) {
        throw new UserInputError('No active order found for session');
      }
      const owned = await this.orderService.findOneByCode(ctx, orderCode, [
        'customer',
        'customer.user',
      ]);
      const canAccess =
        owned != null &&
        (await this.configService.orderOptions.orderByCodeAccessStrategy.canAccessOrder(
          ctx,
          owned
        ));
      if (!canAccess) {
        throw new UserInputError('Payment reference does not match this order');
      }
    }
    const adminCtx = await this.createContext();
    try {
      return await this.connection.withTransaction(adminCtx, async (txCtx) =>
        this.settleVerifiedCharge(txCtx, verified)
      );
    } catch (error) {
      if (error instanceof PaystackSettleRejection) {
        throw new UserInputError(error.message);
      }
      throw error;
    }
  }

  private async settleVerifiedCharge(
    ctx: RequestContext,
    verified: {
      id: number;
      amount: number;
      metadata: Record<string, unknown> | null;
    }
  ): Promise<Order> {
    const orderCode = orderCodeFromMetadata(verified.metadata);
    if (!orderCode) {
      throw new PaystackSettleRejection(
        `Paystack charge is missing ${PAYSTACK_ORDER_CODE_METADATA_KEY}.`
      );
    }
    const found = await this.orderService.findOneByCode(ctx, orderCode);
    if (!found) {
      throw new Error(`Paystack order ${orderCode} could not be loaded.`);
    }
    const order = await this.orderService.findOne(ctx, found.id, ['payments']);
    if (!order) {
      throw new Error(`Paystack order ${orderCode} could not be loaded.`);
    }
    if (order.state === 'PaymentSettled') {
      return order;
    }
    const transactionId = String(verified.id);
    const existing = await this.connection.getRepository(ctx, Payment).findOne({
      where: { transactionId },
    });
    if (existing) {
      return order;
    }
    const chargeAmount = numberFromMetadata(
      verified.metadata,
      CHARGE_AMOUNT_METADATA_KEY
    );
    if (chargeAmount != null && verified.amount !== chargeAmount) {
      throw new PaystackSettleRejection(
        'Verified Paystack amount does not match charge_amount.'
      );
    }
    if (order.state !== 'ArrangingPayment') {
      const transitioned = await this.orderService.transitionToState(
        ctx,
        order.id,
        'ArrangingPayment'
      );
      if (transitioned instanceof OrderStateTransitionError) {
        throw new PaystackSettleRejection(transitioned.message);
      }
    }
    const fresh = await this.orderService.findOne(ctx, order.id, ['payments']);
    if (!fresh) {
      throw new Error(`Paystack order ${orderCode} could not be loaded.`);
    }
    const outstanding = outstandingBalance(fresh);
    const explicitSettlement = numberFromMetadata(
      verified.metadata,
      SETTLEMENT_AMOUNT_METADATA_KEY
    );
    const paymentMethod = await this.getConfiguredPaymentMethod(ctx);
    const metadata = {
      transactionId,
      ...(chargeAmount != null ? { chargeAmount } : {}),
    };
    if (explicitSettlement == null) {
      if (chargeAmount != null && outstanding > chargeAmount) {
        throw new PaystackSettleRejection(
          'Outstanding balance is greater than chargeAmount.'
        );
      }
      const added = await this.orderService.addPaymentToOrder(ctx, fresh.id, {
        method: paymentMethod.code,
        metadata,
      });
      if (!(added instanceof Order)) {
        throw new PaystackSettleRejection(added.message);
      }
      return added;
    }
    if (explicitSettlement > outstanding) {
      throw new PaystackSettleRejection(
        'settlementAmount cannot exceed the outstanding balance.'
      );
    }
    const payment = await this.paymentService.createPayment(
      ctx,
      fresh,
      explicitSettlement,
      paymentMethod.code,
      metadata
    );
    if (isGraphQlErrorResult(payment)) {
      throw new PaystackSettleRejection(payment.message);
    }
    const settled = await this.orderService.findOne(ctx, fresh.id);
    if (!settled) {
      throw new Error(`Paystack order ${orderCode} could not be loaded.`);
    }
    return settled;
  }

  async handleRefundEvent({ data, event }: RefundEvent): Promise<void> {
    const { transaction_reference, refund_reference } = data;

    const outerCtx = await this.createContext();

    this.connection.withTransaction(outerCtx, async (ctx: RequestContext) => {
      const order = await this.orderService.findOneByCode(
        ctx,
        transaction_reference
      );
      if (!order) return;

      const paymentMethod = await this.getConfiguredPaymentMethod(ctx);
      const payment = order.payments.find((p) => p.method === paymentMethod.code);

      if (!payment) {
        Logger.error(
          `No Paystack payment found for order ${order.code}`,
          loggerCtx
        );
        return;
      }

      const pendingRefund = payment.refunds.find(
        (refund) => refund.metadata.public.reference === refund_reference
      );
      if (!pendingRefund) {
        Logger.error(
          `No pending refund found for order ${order.code} with reference ${refund_reference}`,
          loggerCtx
        );
        return;
      }

      switch (event) {
        case 'refund.processed':
          this.orderService.transitionRefundToState(
            ctx,
            pendingRefund.id,
            'Settled'
          );
          break;
        case 'refund.failed':
          this.orderService.transitionRefundToState(
            ctx,
            pendingRefund.id,
            'Failed'
          );
          break;
        default:
          Logger.warn(`Unhandled webhook event type ${event}`, loggerCtx);
      }

      Logger.info(`Refund for order ${order.code} processed`, loggerCtx);
    });
  }

  private async createContext(channelToken?: string): Promise<RequestContext> {
    return this.requestContextService.create({
      apiType: 'admin',
      channelOrToken: channelToken,
      languageCode: LanguageCode.en,
    });
  }
}
