import { Body, Controller, Post } from '@nestjs/common';
import {
  ChannelService,
  LanguageCode,
  Logger,
  RequestContext,
} from '@vendure/core';

import { REVERSAL_CALLBACK_ENDPOINT, loggerCtx } from '../constants';
import { MpesaService } from '../service/mpesa.service';
import { buildLogMessage } from '../service/log-provider-error';
import { type ReversalCallbackPayload } from '../types';

@Controller(REVERSAL_CALLBACK_ENDPOINT)
export class ReversalCallbackController {
  constructor(
    private channelService: ChannelService,
    private mpesaService: MpesaService
  ) {}

  @Post()
  async handleCallback(@Body() payload: ReversalCallbackPayload) {
    const { ResultCode, ResultDesc, TransactionID } = payload.Result;

    Logger.debug(
      buildLogMessage('M-Pesa reversal callback received', {
        transactionId: TransactionID,
        resultCode: ResultCode,
        resultDesc: ResultDesc,
      }),
      loggerCtx
    );

    const ctx = await this.createRequestContext();
    await this.mpesaService.handleReversalCallback(ctx, payload);
  }

  private async createRequestContext(): Promise<RequestContext> {
    const channel = await this.channelService.getDefaultChannel();
    return new RequestContext({
      apiType: 'admin',
      isAuthorized: true,
      authorizedAsOwnerOnly: false,
      channel,
      languageCode: LanguageCode.en,
    });
  }
}
