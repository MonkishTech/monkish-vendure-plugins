import {
  Body,
  Controller,
  Headers,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Logger } from '@vendure/core';
import { createHmac } from 'crypto';
import type { Request, Response } from 'express';
import { loggerCtx } from '../constants';
import { PaystackService } from '../service/paystack.service';
import type { RefundEvent, TransactionEvent, WebhookEvent } from '../types';

function paystackBodyString(req: Request, payload: unknown): string {
  const raw = (req as { rawBody?: Buffer }).rawBody;
  if (raw != null && Buffer.isBuffer(raw)) {
    return raw.toString('utf8');
  }
  return JSON.stringify(payload);
}

@Controller('payments')
export class PaystackController {
  constructor(private paystackService: PaystackService) {}

  @Post('paystack')
  async webhook(
    @Req() req: Request,
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

    const bodyString = paystackBodyString(req, payload);
    const secret = await this.paystackService.getPaystackWebhookSecretKey();
    if (!secret) {
      const msg = 'No Paystack payment methods with a secret key configured';
      Logger.error(msg, loggerCtx);
      response.status(HttpStatus.BAD_REQUEST).send(msg);
      return;
    }

    const hash = createHmac('sha512', secret).update(bodyString).digest('hex');

    if (hash !== signature) {
      const errorMessage = 'Invalid signature';
      Logger.error(errorMessage, loggerCtx);
      response.status(HttpStatus.BAD_REQUEST).send(errorMessage);
      return;
    }

    switch (payload.event) {
      case 'charge.success':
        await this.paystackService.handleSuccessfulCharge(
          payload as TransactionEvent,
          secret
        );
        break;
      case 'refund.processed':
      case 'refund.pending':
      case 'refund.failed':
        await this.paystackService.handleRefundEvent(payload as RefundEvent);
        break;
      default:
        Logger.warn(`Unhandled event type ${payload.event}`, loggerCtx);
    }

    response.status(HttpStatus.OK).send('Ok');
  }
}
