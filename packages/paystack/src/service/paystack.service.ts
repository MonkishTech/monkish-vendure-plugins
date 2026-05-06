import { Injectable } from '@nestjs/common';
import {
  ConfigurableOperation,
  RefundOrderInput,
} from '@vendure/common/lib/generated-types';
import {
  ActiveOrderService,
  ChannelService,
  CreateRefundResult,
  InternalServerError,
  LanguageCode,
  Logger,
  Order,
  OrderService,
  OrderStateTransitionError,
  Payment,
  PaymentMethod,
  PaymentMethodService,
  RequestContext,
  RequestContextService,
  TransactionalConnection,
  UserInputError,
} from '@vendure/core';
import axios, { AxiosError, AxiosInstance } from 'axios';
import { paystackPaymentMethodHandler } from '../config/paystack.handler';
import {
  loggerCtx,
  PAYSTACK_API_URL,
  PAYSTACK_ORDER_CODE_METADATA_KEY,
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
    private channelService: ChannelService,
    private connection: TransactionalConnection,
    private orderService: OrderService,
    private paymentMethodService: PaymentMethodService,
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
    ]);
    if (!order) {
      throw new UserInputError('No order found for active session');
    }

    const {
      channels,
      callbackUrl,
      metadata,
      paystackAmount,
    } = input;
    const { totalWithTax, customer, currencyCode, code } = order;

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

    let amountToCharge = totalWithTax;
    if (paystackAmount != null) {
      if (!Number.isInteger(paystackAmount) || paystackAmount <= 0) {
        throw new UserInputError('paystackAmount must be a positive integer.');
      }
      amountToCharge = paystackAmount;
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
    };

    try {
      const client = this.createPaystackClient(secretKey);
      const { data, status } = await client.post<PaystackPaymentIntent>(
        '/transaction/initialize',
        {
          amount: amountToCharge,
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
  ): Promise<boolean> {
    const client = this.createPaystackClient(secretKey);
    try {
      const {
        data: { data },
        status,
      } = await client.get<VerificationResponse>(
        `/transaction/verify/${transactionReference}`
      );

      if (status !== 200) {
        Logger.error(
          `Could not verify transaction with reference: ${transactionReference}`,
          loggerCtx
        );
        return false;
      }

      return data.status === 'success';
    } catch (error) {
      Logger.error(
        `Could not verify transaction with reference: ${transactionReference}`,
        loggerCtx
      );
      Logger.error(
        JSON.stringify((error as AxiosError).toJSON(), null, 2),
        loggerCtx
      );

      return false;
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
    const isTransactionSuccessful = await this.verifyTransaction(
      webhookSecretKey,
      event.data.reference
    );
    if (!isTransactionSuccessful) return;

    const outerCtx = await this.createContext();

    this.connection.withTransaction(outerCtx, async (ctx: RequestContext) => {
      const meta = event.data.metadata;
      const orderCode =
        meta &&
        typeof meta === 'object' &&
        !Array.isArray(meta) &&
        typeof (meta as Record<string, unknown>)[
          PAYSTACK_ORDER_CODE_METADATA_KEY
        ] === 'string'
          ? String(
              (meta as Record<string, unknown>)[PAYSTACK_ORDER_CODE_METADATA_KEY]
            )
          : undefined;
      if (!orderCode) {
        Logger.error(
          `Paystack charge.success missing ${PAYSTACK_ORDER_CODE_METADATA_KEY} in metadata (reference ${event.data.reference})`,
          loggerCtx
        );
        return;
      }

      const order = await this.orderService.findOneByCode(ctx, orderCode);
      if (!order) return;

      if (order.state !== 'ArrangingPayment') {
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        const ctxWithDefaultChannel = await this.createContext(
          defaultChannel.token
        );

        const transitionToStateResult =
          await this.orderService.transitionToState(
            ctxWithDefaultChannel,
            order.id,
            'ArrangingPayment'
          );

        if (transitionToStateResult instanceof OrderStateTransitionError) {
          Logger.error(
            `Error transitioning order ${order.code} to ArrangingPayment state: ${transitionToStateResult.message}`,
            loggerCtx
          );
          return;
        }
      }

      const paymentMethod = await this.getConfiguredPaymentMethod(ctx);

      const addPaymentToOrderResult = await this.orderService.addPaymentToOrder(
        ctx,
        order.id,
        {
          method: paymentMethod.code,
          metadata: {
            transactionId: event.data.id,
          },
        }
      );

      if (!(addPaymentToOrderResult instanceof Order)) {
        Logger.error(
          `Error adding payment to order ${order.code}: ${addPaymentToOrderResult.message}`,
          loggerCtx
        );
        return;
      }

      Logger.info(`Paystack payment added to order ${order.code}`, loggerCtx);
    });
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
