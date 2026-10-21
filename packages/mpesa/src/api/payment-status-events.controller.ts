import { Controller, Get, Inject, Param, Req, Res } from '@nestjs/common';
import {
  ConfigService,
  Logger,
  Permission,
  RequestContext,
  RequestContextService,
  SessionService,
} from '@vendure/core';
import { extractSessionToken } from '@vendure/core/dist/api/common/extract-session-token';
import type { Request, Response } from 'express';

import {
  DEFAULT_PAYMENT_STATUS_STREAM_TIMEOUT_MS,
  MPESA_PAYMENT_EVENT_NAME,
  MPESA_PAYMENT_STATUS_BUS,
  MPESA_PAYMENT_STATUS_HEARTBEAT_MS,
  loggerCtx,
} from '../constants';
import { MpesaPlugin } from '../mpesa.plugin';
import type {
  MpesaPaymentStatusBus,
  MpesaPaymentStatusUpdate,
} from '../payment-status/mpesa-payment-status-bus';
import { buildLogMessage } from '../service/log-provider-error';
import { MpesaService } from '../service/mpesa.service';

@Controller('mpesa/transactions')
export class PaymentStatusEventsController {
  constructor(
    private configService: ConfigService,
    private requestContextService: RequestContextService,
    private sessionService: SessionService,
    private mpesaService: MpesaService,
    @Inject(MPESA_PAYMENT_STATUS_BUS)
    private paymentStatusBus: MpesaPaymentStatusBus
  ) {}

  @Get(':transactionId/events')
  async events(
    @Req() req: Request,
    @Res() res: Response,
    @Param('transactionId') transactionId: string
  ): Promise<void> {
    const ctx = await this.ownerContext(req);
    if (!ctx) {
      res.status(401).end();
      return;
    }

    let sent = false;
    let open = false;
    let buffered: MpesaPaymentStatusUpdate | undefined;
    let unsubscribe: (() => void) | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = undefined;
      }
      if (timeout) {
        clearTimeout(timeout);
        timeout = undefined;
      }
      unsubscribe?.();
      unsubscribe = undefined;
    };

    const finish = (update?: MpesaPaymentStatusUpdate) => {
      if (sent || res.writableEnded) {
        return;
      }
      sent = true;
      if (update) {
        writeEvent(res, update);
      }
      cleanup();
      res.end();
    };

    try {
      unsubscribe = await this.paymentStatusBus.subscribe(
        transactionId,
        (update) => {
          if (!open) {
            buffered = update;
            return;
          }
          finish(update);
        }
      );
    } catch (error) {
      Logger.error(
        buildLogMessage('M-Pesa payment status subscribe failed', {
          checkoutRequestId: transactionId,
        }),
        loggerCtx,
        error instanceof Error ? error.stack : undefined
      );
      res.status(503).end();
      return;
    }

    const access = await this.mpesaService.streamAccess(ctx, transactionId);
    if (access.kind === 'forbidden') {
      cleanup();
      res.status(403).end();
      return;
    }

    startStream(res);
    if (access.kind === 'terminal') {
      finish(buffered ?? access.update);
      return;
    }

    open = true;
    if (buffered) {
      finish(buffered);
      return;
    }

    const again = await this.mpesaService.streamAccess(ctx, transactionId);
    if (again.kind === 'terminal') {
      finish(again.update);
      return;
    }
    if (again.kind === 'forbidden') {
      sent = true;
      cleanup();
      res.end();
      return;
    }

    req.on('close', () => {
      if (!sent) {
        sent = true;
        cleanup();
      }
    });

    heartbeat = setInterval(() => {
      if (!sent) {
        res.write(': ping\n\n');
      }
    }, MPESA_PAYMENT_STATUS_HEARTBEAT_MS);

    const timeoutMs =
      MpesaPlugin.options?.paymentStatusStreamTimeoutMs ??
      DEFAULT_PAYMENT_STATUS_STREAM_TIMEOUT_MS;
    timeout = setTimeout(() => {
      finish();
    }, timeoutMs);
  }

  private async ownerContext(
    req: Request
  ): Promise<RequestContext | undefined> {
    const { tokenMethod, apiKeyHeaderKey } = this.configService.authOptions;
    const extracted = extractSessionToken(
      req,
      tokenMethod ?? ['cookie', 'bearer'],
      apiKeyHeaderKey
    );
    if (!extracted) {
      return;
    }
    const session = await this.sessionService.getSessionFromToken(
      extracted.token
    );
    if (!session) {
      return;
    }
    const ctx = await this.requestContextService.fromRequest(
      req,
      undefined,
      [Permission.Owner],
      session
    );
    if (
      session.user &&
      (!ctx.authorizedAsOwnerOnly || ctx.activeUserId == null)
    ) {
      return;
    }
    return ctx;
  }
}

function startStream(res: Response): void {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
}

function writeEvent(res: Response, update: MpesaPaymentStatusUpdate): void {
  res.write(
    `event: ${MPESA_PAYMENT_EVENT_NAME}\ndata: ${JSON.stringify(update)}\n\n`
  );
}
