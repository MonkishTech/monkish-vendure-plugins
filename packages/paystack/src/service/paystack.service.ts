import { Inject, Injectable } from '@nestjs/common';
import {
  ActiveOrderService,
  Logger,
  RequestContext,
  UserInputError,
} from '@vendure/core';
import axios, { AxiosError, AxiosInstance } from 'axios';
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
  VerificationResponse,
} from 'src/types';

class PaymentIntentError implements PaystackPaymentIntentError {
  errorCode: ErrorCode = 'ORDER_PAYMENT_STATE_ERROR';
  constructor(public message: string) {}
}

@Injectable()
export class PaystackService {
  constructor(
    private activeOrderService: ActiveOrderService,
    @Inject(PLUGIN_INIT_OPTIONS) private pluginOptions: PaystackPluginOptions
  ) {}

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
        await this.getPaystackApiClient().post<PaystackPaymentIntent>(
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
      Logger.error((error as AxiosError).toJSON().toString(), loggerCtx);
      return new PaymentIntentError(
        "Couldn't initialize transaction. Please try again"
      );
    }
  }

  async verifyTransaction(reference: string) {
    try {
      const {
        data: { data },
        status,
      } = await this.getPaystackApiClient().get<VerificationResponse>(
        `/transaction/verify/${reference}`
      );

      if (status !== 200) {
        Logger.error(
          `Could not verify transaction with reference: ${reference}`,
          loggerCtx
        );
        return;
      }

      const { amount } = data;
    } catch (error) {
      Logger.error(
        `Could not verify transaction with reference: ${reference}`,
        loggerCtx
      );
      Logger.error((error as AxiosError).toJSON().toString(), loggerCtx);
    }
  }

  private getPaystackApiClient(): AxiosInstance {
    return axios.create({
      baseURL: 'https://api.paystack.co',
      headers: {
        Authorization: `Bearer ${this.pluginOptions.secretKey}`,
      },
      validateStatus: (status: number) => status < 500,
    });
  }
}
