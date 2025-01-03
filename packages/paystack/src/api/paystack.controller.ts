import {
  Body,
  Controller,
  Headers,
  HttpStatus,
  Inject,
  Post,
  Res,
} from '@nestjs/common';
import { Logger } from '@vendure/core';
import { createHmac } from 'crypto';
import type { Response } from 'express';
import { loggerCtx, PLUGIN_INIT_OPTIONS } from '../constants';
import { PaystackPluginOptions } from '../paystack.plugin';
import { PaystackService } from '../service/paystack.service';
import { RefundEvent, TransactionEvent, WebhookEvent } from '../types';

@Controller('payments')
export class PaystackController {
  constructor(
    @Inject(PLUGIN_INIT_OPTIONS) private pluginOptions: PaystackPluginOptions,
    private paystackService: PaystackService
  ) {}

  @Post('paystack')
  async webhook(
    @Headers('x-paystack-signature') signature: string | undefined,
    @Body() payload: WebhookEvent,
    @Res() response: Response
  ) {
    if (!signature) {
      const missingHeaderErrorMessage = 'Missing x-paystack-signature header';
      Logger.error(missingHeaderErrorMessage, loggerCtx);
      response.status(HttpStatus.BAD_REQUEST).send(missingHeaderErrorMessage);
      return;
    }

    const hash = createHmac('sha512', this.pluginOptions.secretKey)
      .update(JSON.stringify(payload))
      .digest('hex');

    if (hash !== signature) {
      const errorMessage = 'Invalid signature';
      Logger.error(errorMessage, loggerCtx);
      response.status(HttpStatus.BAD_REQUEST).send(errorMessage);
      return;
    }

    switch (payload.event) {
      case 'charge.success':
        this.paystackService.handleSuccessfulCharge(
          payload as TransactionEvent
        );
        break;
      case 'refund.processed':
      case 'refund.pending':
      case 'refund.failed':
        this.paystackService.handleRefundEvent(payload as RefundEvent);
        break;
      default:
        Logger.warn(`Unhandled event type ${payload.event}`, loggerCtx);
    }

    response.status(HttpStatus.OK).send('Ok');
  }
}
