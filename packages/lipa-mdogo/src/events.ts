import { Order, RequestContext, VendureEvent } from '@vendure/core';

import { LipaMdogoPlan } from './entity/lipa-mdogo-plan.entity';

export class LipaMdogoReminderEvent extends VendureEvent {
  constructor(
    public ctx: RequestContext,
    public order: Order,
    public plan: LipaMdogoPlan,
    public daysBefore: number,
    public outstanding: number
  ) {
    super();
  }
}

export class LipaMdogoPlanCompletedEvent extends VendureEvent {
  constructor(
    public ctx: RequestContext,
    public order: Order,
    public plan: LipaMdogoPlan
  ) {
    super();
  }
}

export class LipaMdogoPlanMissedEvent extends VendureEvent {
  constructor(
    public ctx: RequestContext,
    public order: Order,
    public plan: LipaMdogoPlan
  ) {
    super();
  }
}
