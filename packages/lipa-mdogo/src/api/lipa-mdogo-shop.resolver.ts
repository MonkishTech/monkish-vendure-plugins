import {
  Args,
  Mutation,
  Parent,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import {
  Allow,
  Ctx,
  Order,
  Permission,
  RequestContext,
  UnauthorizedError,
} from '@vendure/core';

import { LipaMdogoService } from '../service/lipa-mdogo.service';

@Resolver()
export class LipaMdogoShopResolver {
  constructor(private readonly lipaMdogoService: LipaMdogoService) {}

  @Mutation()
  @Allow(Permission.Owner)
  async startLipaMdogoPlan(
    @Ctx() ctx: RequestContext,
    @Args('input')
    input: {
      minimumPayment: number;
      deadline: string;
      reminderDaysBefore?: number[] | null;
    }
  ) {
    if (!ctx.authorizedAsOwnerOnly) {
      throw new UnauthorizedError();
    }
    return this.lipaMdogoService.startPlan(ctx, {
      minimumPayment: input.minimumPayment,
      deadline: new Date(input.deadline),
      reminderDaysBefore: input.reminderDaysBefore,
    });
  }
}

@Resolver('Order')
export class LipaMdogoOrderResolver {
  constructor(private readonly lipaMdogoService: LipaMdogoService) {}

  @ResolveField()
  lipaMdogoPlan(@Ctx() ctx: RequestContext, @Parent() order: Order) {
    return this.lipaMdogoService.shopPlanForOrder(ctx, order.id);
  }
}
