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
import { loggerCtx, PLUGIN_INIT_OPTIONS } from 'src/constants';
import { PaystackPluginOptions } from 'src/paystack.plugin';
import { PaystackService } from 'src/service/paystack.service';
import { WebhookEvent } from 'src/types';

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

    // if(payload.event === 'paymentrequest.success' || payload.event === 'charge.success') {

    // }

    return { received: true };
  }
}
