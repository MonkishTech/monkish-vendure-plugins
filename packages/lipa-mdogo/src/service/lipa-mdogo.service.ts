import { Injectable } from '@nestjs/common';
import {
  ActiveOrderService,
  EventBus,
  ID,
  Logger,
  Order,
  OrderService,
  RequestContext,
  RequestContextService,
  TransactionalConnection,
  UserInputError,
} from '@vendure/core';

import { LipaMdogoPlan } from '../entity/lipa-mdogo-plan.entity';
import { LipaMdogoReminderEvent } from '../events';
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
    private connection: TransactionalConnection,
    private requestContextService: RequestContextService,
    private eventBus: EventBus
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
    if (order.state !== 'ArrangingPayment') {
      throw new UserInputError(
        'Lipa mdogo requires the order to be ArrangingPayment.'
      );
    }
    if (!order.customer) {
      throw new UserInputError('No customer found for active order');
    }
    if (!Number.isInteger(input.minimumPayment) || input.minimumPayment <= 0) {
      throw new UserInputError('minimumPayment must be a positive integer.');
    }
    if (input.minimumPayment > order.totalWithTax) {
      throw new UserInputError('minimumPayment cannot exceed the order total.');
    }
    if (input.deadline.getTime() <= this.clock().getTime()) {
      throw new UserInputError('deadline must be in the future.');
    }
    if (
      input.reminderDaysBefore != null &&
      !input.reminderDaysBefore.every(
        (day) => Number.isInteger(day) && day >= 0
      )
    ) {
      throw new UserInputError(
        'reminderDaysBefore must be a list of integers greater than or equal to zero.'
      );
    }
    const existing = await this.connection
      .getRepository(ctx, LipaMdogoPlan)
      .findOne({ where: { order: { id: order.id } } });
    if (existing) {
      throw new UserInputError('This order already has a lipa mdogo plan.');
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
    const ctx = await this.requestContextService.create({ apiType: 'admin' });
    const plans = await this.connection.getRepository(ctx, LipaMdogoPlan).find({
      where: { state: 'Active' },
      relations: { order: { payments: true }, channel: true },
    });
    for (const plan of plans) {
      await this.publishDueReminders(plan);
    }
  }

  private async publishDueReminders(plan: LipaMdogoPlan): Promise<void> {
    const ctx = await this.requestContextService.create({
      apiType: 'admin',
      channelOrToken: plan.channel,
    });
    const order = await this.orderService.findOne(ctx, plan.order.id, [
      'payments',
    ]);
    if (!order) {
      Logger.warn(`Lipa mdogo order ${plan.order.id} could not be loaded.`);
      return;
    }
    const outstanding = outstandingBalance(order);
    const now = this.clock();
    const deadline = new Date(plan.deadline);
    if (outstanding <= 0 || order.state === 'Cancelled') {
      return;
    }
    if (now >= deadline) {
      return;
    }
    const sent = [...plan.remindersSent];
    for (const offset of plan.reminderDaysBefore) {
      if (sent.includes(offset) || !isReminderDue(now, deadline, offset)) {
        continue;
      }
      await this.eventBus.publish(
        new LipaMdogoReminderEvent(ctx, order, plan, offset, outstanding)
      );
      sent.push(offset);
      plan.remindersSent = sent;
      await this.connection.getRepository(ctx, LipaMdogoPlan).save(plan);
    }
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
