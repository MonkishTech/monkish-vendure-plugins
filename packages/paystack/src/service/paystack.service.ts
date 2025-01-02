import { Inject, Injectable } from '@nestjs/common';
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
import { RefundOrderInput } from '@vendure/common/lib/generated-types';
import axios, { AxiosError, AxiosInstance } from 'axios';
import { paystackPaymentMethodHandler } from 'src/config/paystack.handler';
import {
  loggerCtx,
  PLUGIN_INIT_OPTIONS,
  SUPPORTED_CURRENCICES,
} from 'src/constants';
import { PaystackPluginOptions } from 'src/paystack.plugin';
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
} from 'src/types';

class PaymentIntentError implements PaystackPaymentIntentError {
  errorCode: ErrorCode = 'ORDER_PAYMENT_STATE_ERROR';
  constructor(public message: string) {}
}

@Injectable()
export class PaystackService {
  private paystackApiClient: AxiosInstance;

  constructor(
    @Inject(PLUGIN_INIT_OPTIONS) private pluginOptions: PaystackPluginOptions,
    private activeOrderService: ActiveOrderService,
    private channelService: ChannelService,
    private connection: TransactionalConnection,
    private orderService: OrderService,
    private paymentMethodService: PaymentMethodService,
    private requestContextService: RequestContextService
  ) {
    this.paystackApiClient = axios.create({
      baseURL: 'https://api.paystack.co',
      headers: {
        Authorization: `Bearer ${this.pluginOptions.secretKey}`,
      },
      validateStatus: (status: number) => status < 500,
    });
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

    const { channels, callbackUrl, metadata } = input;
    const { totalWithTax, customer, currencyCode, code } = sessionOrder;

    if (!customer) {
      throw new UserInputError('No customer found for active order');
    }

    if (!SUPPORTED_CURRENCICES.includes(currencyCode)) {
      return new PaymentIntentError(`
        Currency code ${currencyCode} is not supported by Paystack. 
        Supported currencies are: ${SUPPORTED_CURRENCICES.join(', ')}
      `);
    }

    try {
      const { data, status } =
        await this.paystackApiClient.post<PaystackPaymentIntent>(
          '/transaction/initialize',
          {
            amount: totalWithTax,
            email: customer.emailAddress,
            currency: currencyCode,
            reference: code,
            callback_url: callbackUrl,
            metadata,
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

  async verifyTransaction(transactionReference: string): Promise<boolean> {
    try {
      const {
        data: { data },
        status,
      } = await this.paystackApiClient.get<VerificationResponse>(
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
    input: RefundOrderInput,
    order: Order,
    payment: Payment
  ): Promise<CreateRefundResult> {
    try {
      const { reason } = input;

      const {
        data: { data },
        status,
      } = await this.paystackApiClient.post<RefundResponse>('/refund', {
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

  async handleSuccessfulCharge({ data }: TransactionEvent): Promise<void> {
    const isTransactionSuccessful = await this.verifyTransaction(
      data.reference
    );
    if (!isTransactionSuccessful) return;

    const outerCtx = await this.createContext();

    this.connection.withTransaction(outerCtx, async (ctx: RequestContext) => {
      const order = await this.orderService.findOneByCode(ctx, data.reference);
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

      const paymentMethod = await this.getPaymentMethod(ctx);

      const addPaymentToOrderResult = await this.orderService.addPaymentToOrder(
        ctx,
        order.id,
        {
          method: paymentMethod.code,
          metadata: {
            transactionId: data.id,
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

      const payment = order.payments.find(
        (p) => p.method === paystackPaymentMethodHandler.code
      );

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

  private async getPaymentMethod(ctx: RequestContext): Promise<PaymentMethod> {
    const method = (await this.paymentMethodService.findAll(ctx)).items.find(
      (m) => m.handler.code === paystackPaymentMethodHandler.code
    );

    if (!method) {
      throw new InternalServerError(
        `[${loggerCtx}] Could not find Paystack PaymentMethod`
      );
    }

    return method;
  }

  private async createContext(channelToken?: string): Promise<RequestContext> {
    return this.requestContextService.create({
      apiType: 'admin',
      channelOrToken: channelToken,
      languageCode: LanguageCode.en,
    });
  }
}
