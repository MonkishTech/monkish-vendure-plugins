import crypto, { X509Certificate } from 'crypto';

import { Inject, Injectable } from '@nestjs/common';
import {
  ActiveOrderService,
  CreateRefundResult,
  CurrencyCode,
  Logger,
  Order,
  OrderService,
  OrderStateTransitionError,
  Payment,
  PaymentMethod,
  PaymentService,
  Refund,
  RequestContext,
  TransactionalConnection,
  isGraphQlErrorResult,
} from '@vendure/core';
import axios, { AxiosInstance } from 'axios';

import { mpesaPaymentMethodHandler } from '../config/mpesa.handler';
import {
  MpesaPaymentStatusBus,
  MpesaPaymentStatusUpdate,
} from '../payment-status/mpesa-payment-status-bus';
import {
  LIVE_BASE_URL,
  MPESA_PAYMENT_FAILED_MESSAGE,
  MPESA_PAYMENT_STATUS_BUS,
  MPESA_PAYMENT_SUCCESS_MESSAGE,
  REVERSAL_CALLBACK_ENDPOINT,
  SANDBOX_BASE_URL,
  STK_PUSH_CALLBACK_ENDPOINT,
  loggerCtx,
} from '../constants';
import {
  MpesaConfig,
  MpesaTransactionInitiation,
  MpesaTransactionVerification,
  ReversalCallbackPayload,
  ReversalResponse,
  STKCallbackPayload,
  STKPushResponse,
  STKStatusResponse,
  TokenResponse,
} from '../types';
import { formatPhoneNumber } from '../util/phone-utils';
import { buildLogMessage, logProviderError } from './log-provider-error';

export class MpesaSettleRejection extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MpesaSettleRejection';
  }
}

export type MpesaStreamAccess =
  | { kind: 'forbidden' }
  | { kind: 'pending' }
  | { kind: 'terminal'; update: MpesaPaymentStatusUpdate };

function ownedByActiveUser(
  order: Order,
  activeUserId: RequestContext['activeUserId']
): boolean {
  const userId = order.customer?.user?.id;
  return (
    activeUserId != null && userId != null && String(userId) === String(activeUserId)
  );
}

function outstandingBalance(order: Order): number {
  const covered = (order.payments ?? [])
    .filter((payment) => payment.state === 'Settled')
    .reduce((sum, payment) => sum + payment.amount, 0);
  return order.totalWithTax - covered;
}

function roundUpToShilling(minor: number): number {
  return Math.ceil(minor / 100) * 100;
}

function resolveMpesaAmounts(
  input: { chargeAmount?: number | null; settlementAmount?: number | null },
  outstanding: number
):
  | { chargeAmount: number; settlementAmount: number | null }
  | { message: string } {
  const { chargeAmount, settlementAmount } = input;
  if (settlementAmount != null) {
    if (!Number.isInteger(settlementAmount) || settlementAmount <= 0) {
      return { message: 'settlementAmount must be a positive integer.' };
    }
    if (settlementAmount > outstanding) {
      return {
        message: 'settlementAmount cannot exceed the outstanding balance.',
      };
    }
  }
  const settlement = settlementAmount ?? outstanding;
  if (!Number.isInteger(settlement) || settlement <= 0) {
    return { message: 'settlementAmount must be a positive integer.' };
  }
  const charge = chargeAmount ?? roundUpToShilling(settlement);
  if (!Number.isInteger(charge) || charge <= 0) {
    return { message: 'chargeAmount must be a positive integer.' };
  }
  if (charge % 100 !== 0) {
    return { message: 'chargeAmount must be a whole number of shillings.' };
  }
  if (charge < settlement) {
    return {
      message: 'chargeAmount cannot be less than the settlement amount.',
    };
  }
  return {
    chargeAmount: charge,
    settlementAmount: settlementAmount == null ? null : settlementAmount,
  };
}

@Injectable()
export class MpesaService {
  private _accessTokenCache = new Map<
    string,
    { token: string; expiryDate: Date }
  >();

  constructor(
    private activeOrderService: ActiveOrderService,
    private connection: TransactionalConnection,
    private orderService: OrderService,
    private paymentService: PaymentService,
    @Inject(MPESA_PAYMENT_STATUS_BUS)
    private paymentStatusBus: MpesaPaymentStatusBus
  ) {}

  async initiateStkPush(
    ctx: RequestContext,
    phoneNumber: string,
    input: {
      chargeAmount?: number | null;
      settlementAmount?: number | null;
    } = {}
  ): Promise<MpesaTransactionInitiation> {
    const sessionOrder = await this.activeOrderService.getActiveOrder(
      ctx,
      undefined
    );
    if (!sessionOrder) {
      return {
        success: false,
        transactionId: '',
        message: 'No active order found for session',
      };
    }

    const order = await this.orderService.findOne(ctx, sessionOrder.id, [
      'customer',
      'payments',
    ]);
    if (!order) {
      return {
        success: false,
        transactionId: '',
        message: 'No order found for active session',
      };
    }

    const { customer, currencyCode, code } = order;
    if (!customer) {
      return {
        success: false,
        transactionId: '',
        message: 'No customer found for active order',
      };
    }

    if (currencyCode !== CurrencyCode.KES) {
      return {
        success: false,
        transactionId: '',
        message: 'Mpesa only supports KES currency',
      };
    }

    const resolved = resolveMpesaAmounts(input, outstandingBalance(order));
    if ('message' in resolved) {
      return {
        success: false,
        transactionId: '',
        message: resolved.message,
      };
    }

    try {
      const config = await this.getMpesaConfig(ctx);

      const { shortCodeType } = config;
      const transactionType =
        shortCodeType === 'paybill'
          ? 'CustomerPayBillOnline'
          : 'CustomerBuyGoodsOnline';
      const timestamp = this.getCurrentTimestamp();

      const client = await this.getRequestClient(config);

      const formattedPhoneNumber = formatPhoneNumber(phoneNumber);
      const { data } = await client.post<STKPushResponse>(
        '/stkpush/v1/processrequest',
        {
          BusinessShortCode: config.shortCode,
          Password: this.getLnmPassword(config, timestamp),
          Timestamp: timestamp,
          TransactionType: transactionType,
          Amount: resolved.chargeAmount / 100,
          PartyA: formattedPhoneNumber,
          PartyB: config.shortCode,
          PhoneNumber: formattedPhoneNumber,
          CallBackURL: `${config.vendureHost}/${STK_PUSH_CALLBACK_ENDPOINT}`,
          AccountReference: code,
          TransactionDesc: `${code} Mpesa Payment`,
        }
      );

      if (data.ResponseCode !== '0') {
        Logger.error(
          buildLogMessage('M-Pesa STK push failed', {
            orderCode: code,
            responseCode: data.ResponseCode,
            responseDescription: data.ResponseDescription,
          }),
          loggerCtx
        );
        return {
          success: false,
          transactionId: '',
          message: data.ResponseDescription,
        };
      }

      await this.orderService.updateCustomFields(ctx, order.id, {
        mpesaCheckoutRequestID: data.CheckoutRequestID,
        mpesaChargeAmount: resolved.chargeAmount,
        mpesaSettlementAmount: resolved.settlementAmount,
      });

      return {
        success: true,
        transactionId: data.CheckoutRequestID,
        message: data.ResponseDescription,
      };
    } catch (error) {
      logProviderError('M-Pesa STK push failed', error, { orderCode: code });

      return {
        success: false,
        transactionId: '',
        message: 'Could not initiate STK push',
      };
    }
  }

  async checkTransactionStatus(
    config: MpesaConfig,
    transactionId: string
  ): Promise<{
    isSuccessful: boolean;
    message: string;
    requestFailed?: boolean;
  }> {
    const client = await this.getRequestClient(config);

    const { shortCode } = config;
    const timestamp = this.getCurrentTimestamp();
    const password = this.getLnmPassword(config, timestamp);

    try {
      const { data } = await client.post<STKStatusResponse>(
        '/stkpushquery/v1/query',
        {
          BusinessShortCode: shortCode,
          Password: password,
          Timestamp: timestamp,
          CheckoutRequestID: transactionId,
        }
      );

      const isSuccessful = data.ResultCode === '0' && data.ResponseCode === '0';

      return { isSuccessful, message: data.ResultDesc };
    } catch (error) {
      logProviderError('M-Pesa STK status query failed', error, {
        checkoutRequestId: transactionId,
      });

      return {
        isSuccessful: false,
        message: 'Could not query transaction status',
        requestFailed: true,
      };
    }
  }

  async verifyMpesaPayment(
    ctx: RequestContext,
    transactionId: string
  ): Promise<MpesaTransactionVerification> {
    const payment = await this.getPaymentByTransactionId(ctx, transactionId);
    if (payment) {
      return {
        status: 'SUCCESS',
        transactionId,
        message: MPESA_PAYMENT_SUCCESS_MESSAGE,
      };
    }

    const order = await this.connection.getRepository(ctx, Order).findOne({
      where: {
        customFields: {
          mpesaCheckoutRequestID: transactionId,
        },
      },
    });
    if (!order) {
      // The mpesaCheckoutRequestID custom field is set to null when the payment is failed
      return {
        status: 'FAILED',
        transactionId,
        message: MPESA_PAYMENT_FAILED_MESSAGE,
      };
    }

    return {
      status: 'PENDING',
      transactionId,
      message: 'Payment is still pending',
    };
  }

  async streamAccess(
    ctx: RequestContext,
    transactionId: string
  ): Promise<MpesaStreamAccess> {
    const payment = await this.connection.getRepository(ctx, Payment).findOne({
      where: { transactionId },
      relations: ['order', 'order.customer', 'order.customer.user'],
    });
    if (payment) {
      if (!ownedByActiveUser(payment.order, ctx.activeUserId)) {
        return { kind: 'forbidden' };
      }
      return {
        kind: 'terminal',
        update: {
          transactionId,
          status: 'SUCCESS',
          message: MPESA_PAYMENT_SUCCESS_MESSAGE,
        },
      };
    }

    const order = await this.connection.getRepository(ctx, Order).findOne({
      where: {
        customFields: { mpesaCheckoutRequestID: transactionId },
      },
      relations: ['customer', 'customer.user'],
    });
    if (!order || !ownedByActiveUser(order, ctx.activeUserId)) {
      return { kind: 'forbidden' };
    }
    return { kind: 'pending' };
  }

  async handleStkPushCallback(
    ctx: RequestContext,
    payload: STKCallbackPayload
  ) {
    const { CheckoutRequestID, ResultCode } = payload.Body.stkCallback;

    const existingPayment = await this.getPaymentByTransactionId(
      ctx,
      CheckoutRequestID
    );
    if (existingPayment) {
      Logger.debug(
        buildLogMessage('M-Pesa STK callback already processed', {
          checkoutRequestId: CheckoutRequestID,
        }),
        loggerCtx
      );
      return;
    }

    const isSuccess = ResultCode === 0;
    if (!isSuccess) {
      const order = await this.connection.getRepository(ctx, Order).findOne({
        where: {
          customFields: {
            mpesaCheckoutRequestID: CheckoutRequestID,
          },
        },
      });
      Logger.warn(
        buildLogMessage('M-Pesa STK callback failed', {
          checkoutRequestId: CheckoutRequestID,
          resultCode: ResultCode,
          resultDesc: payload.Body.stkCallback.ResultDesc,
          orderCode: order?.code,
        }),
        loggerCtx
      );
      if (!order) return;
      await this.orderService.updateCustomFields(ctx, order.id, {
        mpesaCheckoutRequestID: null,
        mpesaChargeAmount: null,
        mpesaSettlementAmount: null,
      });
      await this.publishPaymentStatus({
        transactionId: CheckoutRequestID,
        status: 'FAILED',
        message: MPESA_PAYMENT_FAILED_MESSAGE,
      });
      return;
    }

    await this.connection.withTransaction(ctx, async (txCtx) => {
      const order = await this.connection.getRepository(txCtx, Order).findOne({
        where: {
          customFields: {
            mpesaCheckoutRequestID: CheckoutRequestID,
          },
        },
        relations: ['payments'],
      });
      if (!order) {
        throw new Error(
          `M-Pesa order for ${CheckoutRequestID} could not be loaded.`
        );
      }
      await this.settleSuccessfulCallback(txCtx, order, payload);
    });

    await this.publishPaymentStatus({
      transactionId: CheckoutRequestID,
      status: 'SUCCESS',
      message: MPESA_PAYMENT_SUCCESS_MESSAGE,
    });

    const config = await this.getMpesaConfig(ctx);
    const queryResult = await this.checkTransactionStatus(
      config,
      CheckoutRequestID
    );
    if (!queryResult.isSuccessful && !queryResult.requestFailed) {
      Logger.warn(
        buildLogMessage('M-Pesa STK status query was not successful', {
          checkoutRequestId: CheckoutRequestID,
          message: queryResult.message,
        }),
        loggerCtx
      );
    }
  }

  private async publishPaymentStatus(
    update: MpesaPaymentStatusUpdate
  ): Promise<void> {
    try {
      await this.paymentStatusBus.publish(update);
    } catch (error) {
      Logger.error(
        buildLogMessage('M-Pesa payment status publish failed', {
          checkoutRequestId: update.transactionId,
        }),
        loggerCtx,
        error instanceof Error ? error.stack : undefined
      );
    }
  }

  private async settleSuccessfulCallback(
    ctx: RequestContext,
    order: Order,
    payload: STKCallbackPayload
  ) {
    const { CheckoutRequestID, CallbackMetadata } = payload.Body.stkCallback;
    const charge = order.customFields.mpesaChargeAmount;
    const settlement = order.customFields.mpesaSettlementAmount;
    const amountValue = CallbackMetadata?.Item?.find(
      (item) => item.Name === 'Amount'
    )?.Value;
    const shillings = Number(amountValue);
    const usable = Number.isInteger(shillings) && shillings > 0;
    if (typeof charge === 'number' && (!usable || shillings * 100 !== charge)) {
      throw new MpesaSettleRejection(
        'Verified M-Pesa amount does not match mpesaChargeAmount.'
      );
    }

    if (order.state !== 'ArrangingPayment') {
      const transitioned = await this.orderService.transitionToState(
        ctx,
        order.id,
        'ArrangingPayment'
      );
      if (transitioned instanceof OrderStateTransitionError) {
        throw new MpesaSettleRejection(transitioned.message);
      }
    }

    const fresh = await this.orderService.findOne(ctx, order.id, ['payments']);
    if (!fresh) {
      throw new Error(
        `M-Pesa order for ${CheckoutRequestID} could not be loaded.`
      );
    }

    const outstanding = outstandingBalance(fresh);
    const receipt =
      CallbackMetadata?.Item?.find((item) => item.Name === 'MpesaReceiptNumber')
        ?.Value ?? 'N/A';
    const metadata = {
      CheckoutRequestID,
      MpesaReceiptNumber: receipt,
      ...(typeof charge === 'number' ? { chargeAmount: charge } : {}),
    };

    if (settlement == null) {
      if (typeof charge === 'number' && outstanding > charge) {
        throw new MpesaSettleRejection(
          'Outstanding balance is greater than chargeAmount.'
        );
      }
      const added = await this.orderService.addPaymentToOrder(ctx, fresh.id, {
        method: mpesaPaymentMethodHandler.code,
        metadata,
      });
      if (!(added instanceof Order)) {
        throw new MpesaSettleRejection(added.message);
      }
      Logger.info(
        buildLogMessage('M-Pesa payment added', {
          orderCode: fresh.code,
          receipt,
        }),
        loggerCtx
      );
      return;
    }

    if (settlement > outstanding) {
      throw new MpesaSettleRejection(
        'settlementAmount cannot exceed the outstanding balance.'
      );
    }
    const payment = await this.paymentService.createPayment(
      ctx,
      fresh,
      settlement,
      mpesaPaymentMethodHandler.code,
      metadata
    );
    if (isGraphQlErrorResult(payment)) {
      throw new MpesaSettleRejection(payment.message);
    }
    Logger.info(
      buildLogMessage('M-Pesa payment added', {
        orderCode: fresh.code,
        receipt,
      }),
      loggerCtx
    );
  }

  async reversePayment(
    ctx: RequestContext,
    transactionId: string,
    reason?: string
  ): Promise<CreateRefundResult> {
    const payment = await this.getPaymentByTransactionId(ctx, transactionId);
    if (!payment) {
      Logger.warn(
        buildLogMessage('No M-Pesa payment found for refund', {
          transactionId,
        }),
        loggerCtx
      );
      return {
        state: 'Failed',
        transactionId: '',
        metadata: {
          errorMessage: 'No payment found for transaction',
        },
      };
    }

    const receipt = payment.metadata.mpesaReceiptNumber;
    if (typeof receipt !== 'string' || receipt.length === 0) {
      Logger.warn(
        buildLogMessage('M-Pesa payment has no receipt', {
          transactionId,
        }),
        loggerCtx
      );
      return {
        state: 'Failed',
        transactionId: '',
      };
    }
    const chargeAmount = payment.metadata.chargeAmount;
    const amountShillings =
      typeof chargeAmount === 'number'
        ? chargeAmount / 100
        : Math.trunc(payment.amount / 100);

    try {
      const config = await this.getMpesaConfig(ctx);
      const client = await this.getRequestClient(config);

      const { data } = await client.post<ReversalResponse>(
        '/reversal/v1/request',
        {
          CommandID: 'TransactionReversal',
          ReceiverParty: config.shortCode,
          RecieverIdentifierType: '11',
          Remarks: `Mpesa Reversal${reason ? `: ${reason}` : ''}`,
          Initiator: config.initiatorName,
          SecurityCredential: this.getSecurityCredential(config),
          QueueTimeOutURL: `${config.vendureHost}/${REVERSAL_CALLBACK_ENDPOINT}`,
          ResultURL: `${config.vendureHost}/${REVERSAL_CALLBACK_ENDPOINT}`,
          TransactionID: receipt,
          Amount: amountShillings,
        }
      );

      if (data.ResponseCode !== '0') {
        Logger.error(
          buildLogMessage('M-Pesa reversal failed', {
            transactionId,
            responseCode: data.ResponseCode,
          }),
          loggerCtx
        );
        return {
          state: 'Failed',
          transactionId: receipt,
        };
      }

      return {
        state: 'Validating',
        transactionId: receipt,
        metadata: {
          conversationID: data.OriginatorConversationID,
        },
      };
    } catch (error) {
      logProviderError('M-Pesa reversal failed', error, { transactionId });
      return {
        state: 'Failed',
        transactionId: receipt,
      };
    }
  }

  async handleReversalCallback(
    ctx: RequestContext,
    payload: ReversalCallbackPayload
  ) {
    const { ResultCode, ResultDesc, TransactionID } = payload.Result;

    const refund = await this.connection.getRepository(ctx, Refund).findOne({
      where: { transactionId: TransactionID },
    });

    if (!refund) {
      Logger.warn(
        buildLogMessage('No M-Pesa refund found', {
          transactionId: TransactionID,
        }),
        loggerCtx
      );
      return;
    }

    if (ResultCode === '0') {
      await this.orderService.settleRefund(ctx, {
        id: refund.id,
        transactionId: TransactionID,
      });
      Logger.info(
        buildLogMessage('M-Pesa refund settled', {
          transactionId: TransactionID,
        }),
        loggerCtx
      );
    } else {
      await this.orderService.transitionRefundToState(ctx, refund.id, 'Failed');
      Logger.error(
        buildLogMessage('M-Pesa refund failed', {
          transactionId: TransactionID,
          resultDesc: ResultDesc,
        }),
        loggerCtx
      );
    }
  }

  private async getPaymentByTransactionId(
    ctx: RequestContext,
    transactionId: string
  ): Promise<Payment | undefined> {
    const payment = await this.connection.getRepository(ctx, Payment).findOne({
      where: { transactionId },
      relations: ['order', 'order.payments', 'refunds'],
    });

    if (!payment) {
      return;
    }

    return payment;
  }

  private async getMpesaConfig(ctx: RequestContext): Promise<MpesaConfig> {
    const paymentMethod = await this.connection
      .getRepository(ctx, PaymentMethod)
      .findOne({
        where: { code: mpesaPaymentMethodHandler.code },
      });

    if (!paymentMethod) {
      Logger.error(
        buildLogMessage('M-Pesa payment method not found'),
        loggerCtx
      );
      throw new Error('Mpesa payment method not found');
    }

    const config = Object.fromEntries(
      (paymentMethod.handler.args as { name: string; value: unknown }[]).map(
        ({ name, value }) => [name, value]
      )
    ) as unknown as MpesaConfig;

    return config;
  }

  private async getRequestClient(config: MpesaConfig): Promise<AxiosInstance> {
    const accessToken = await this.getAccessToken(config);

    return axios.create({
      baseURL: `${this.getBaseUrl(config)}/mpesa`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
  }

  private getBaseUrl(config: MpesaConfig): string {
    return config.environment === 'sandbox' ? SANDBOX_BASE_URL : LIVE_BASE_URL;
  }

  private getCurrentTimestamp(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const seconds = now.getSeconds().toString().padStart(2, '0');

    return `${year}${month}${day}${hours}${minutes}${seconds}`;
  }

  private getLnmPassword(config: MpesaConfig, timestamp: string): string {
    const { shortCode, passkey } = config;
    return Buffer.from(`${shortCode}${passkey}${timestamp}`).toString('base64');
  }

  private async getAccessToken(config: MpesaConfig): Promise<string> {
    const cacheKey = `${config.consumerKey}:${config.environment}`;
    const cached = this._accessTokenCache.get(cacheKey);

    if (cached && cached.expiryDate > new Date()) {
      return cached.token;
    }

    const { consumerKey, consumerSecret } = config;
    const url = `${this.getBaseUrl(
      config
    )}/oauth/v1/generate?grant_type=client_credentials`;
    const auth = `Basic ${Buffer.from(
      `${consumerKey}:${consumerSecret}`
    ).toString('base64')}`;

    try {
      const { data } = await axios.get<TokenResponse>(url, {
        headers: { Authorization: auth },
      });

      const expiryDate = new Date();
      expiryDate.setSeconds(
        expiryDate.getSeconds() + parseInt(data.expires_in) - 60
      );

      this._accessTokenCache.set(cacheKey, {
        token: data.access_token,
        expiryDate,
      });

      return data.access_token;
    } catch (error) {
      logProviderError(
        'Could not authenticate to the M-Pesa API. Check the consumer key, secret, and environment.',
        error
      );
      return '';
    }
  }

  private getSecurityCredential(config: MpesaConfig): string {
    const passwordBuffer = Buffer.from(config.initiatorPassword);
    const cert = new X509Certificate(
      this.rebuildPemFromSingleLineCert(config.apiCertificate)
    );

    const encryptedPassword = crypto.publicEncrypt(
      {
        key: cert.publicKey,
        padding: crypto.constants.RSA_PKCS1_PADDING,
      },
      passwordBuffer
    );
    return encryptedPassword.toString('base64');
  }

  private rebuildPemFromSingleLineCert(input: string): string {
    let s = String(input).trim();
    s = s.replace(/\\n/g, '\n');

    s = s
      .replace(/-----BEGIN CERTIFICATE-----/g, '')
      .replace(/-----END CERTIFICATE-----/g, '');

    const base64Only = s.replace(/\s+/g, '');

    if (!/^[A-Za-z0-9+/=]+$/.test(base64Only) || base64Only.length < 100) {
      throw new Error(
        'Input does not look like a valid base64 certificate payload.'
      );
    }

    const chunks = base64Only.match(/.{1,64}/g);
    if (!chunks) {
      throw new Error(
        'Input does not look like a valid base64 certificate payload.'
      );
    }
    const folded = chunks.join('\n');

    return `-----BEGIN CERTIFICATE-----\n${folded}\n-----END CERTIFICATE-----\n`;
  }
}
