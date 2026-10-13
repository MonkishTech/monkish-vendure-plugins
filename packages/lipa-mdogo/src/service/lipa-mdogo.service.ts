import { Injectable } from '@nestjs/common';
import {
  ActiveOrderService,
  ID,
  Order,
  OrderService,
  RequestContext,
  TransactionalConnection,
  UserInputError,
} from '@vendure/core';

import { LipaMdogoPlan } from '../entity/lipa-mdogo-plan.entity';
import { LipaMdogoPlugin } from '../lipa-mdogo.plugin';
import { isReminderDue, outstandingBalance } from './amounts';
import { anyAmountUntilDeadline } from './strategies';

const DEFAULT_REMINDER_DAYS = [7, 1, 0];

export interface ShopLipaMdogoPlan {
  minimumPayment: number;
  deadline: Date;
  outstanding: number;
  minimumDue: number;
  state: 'Active' | 'Completed' | 'Missed';
}

export interface StartLipaMdogoPlanInput {
  minimumPayment: number;
  deadline: Date;
  reminderDaysBefore?: number[] | null;
}

@Injectable()
export class LipaMdogoService {
  constructor(
    private activeOrderService: ActiveOrderService,
    private orderService: OrderService,
    private connection: TransactionalConnection
  ) {}

  async startPlan(
    ctx: RequestContext,
    input: StartLipaMdogoPlanInput
  ): Promise<ShopLipaMdogoPlan> {
    const sessionOrder = await this.activeOrderService.getActiveOrder(
      ctx,
      undefined
    );
    if (!sessionOrder) {
      throw new UserInputError('No active order found for session');
    }
    const order = await this.orderService.findOne(ctx, sessionOrder.id, [
      'payments',
      'customer',
    ]);
    if (!order) {
      throw new UserInputError('No active order found for session');
    }

    const reminderDaysBefore = uniqueOffsets(input.reminderDaysBefore);
    const now = this.clock();
    const plan = await this.connection.getRepository(ctx, LipaMdogoPlan).save(
      new LipaMdogoPlan({
        order,
        channel: ctx.channel,
        minimumPayment: input.minimumPayment,
        deadline: input.deadline,
        reminderDaysBefore,
        remindersSent: reminderDaysBefore.filter((offset) =>
          isReminderDue(now, input.deadline, offset)
        ),
        state: 'Active',
      })
    );
    return this.toShopPlan(order, plan);
  }

  async shopPlanForOrder(
    ctx: RequestContext,
    orderId: ID
  ): Promise<ShopLipaMdogoPlan | null> {
    const plan = await this.connection
      .getRepository(ctx, LipaMdogoPlan)
      .findOne({
        where: { order: { id: orderId } },
      });
    if (!plan) {
      return null;
    }
    const order = await this.orderService.findOne(ctx, orderId, ['payments']);
    if (!order) {
      return null;
    }
    return this.toShopPlan(order, plan);
  }

  async runDuePlans(): Promise<void> {
    return;
  }

  private clock(): Date {
    return LipaMdogoPlugin.options.clock?.() ?? new Date();
  }

  private toShopPlan(order: Order, plan: LipaMdogoPlan): ShopLipaMdogoPlan {
    const outstanding = outstandingBalance(order);
    const strategy =
      LipaMdogoPlugin.options.planStrategy ?? anyAmountUntilDeadline;
    return {
      minimumPayment: plan.minimumPayment,
      deadline: plan.deadline,
      outstanding,
      minimumDue: strategy.minimumDue(plan.minimumPayment, outstanding),
      state: plan.state,
    };
  }
}

function uniqueOffsets(days: number[] | null | undefined): number[] {
  const source = days ?? DEFAULT_REMINDER_DAYS;
  const seen = new Set<number>();
  const result: number[] = [];
  for (const day of source) {
    if (seen.has(day)) {
      continue;
    }
    seen.add(day);
    result.push(day);
  }
  return result;
}
