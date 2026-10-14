import { Args, Mutation, ResolveField, Resolver } from '@nestjs/graphql';
import {
  Allow,
  Ctx,
  Order,
  Permission,
  RequestContext,
  UnauthorizedError,
} from '@vendure/core';
import { PaystackService } from '../service/paystack.service';
import {
  PaystackPaymentIntent,
  PaystackPaymentIntentError,
  PaystackPaymentIntentInput,
  PaystackPaymentIntentResult,
} from '../types';

@Resolver()
export class PaystackResolver {
  constructor(private paystackService: PaystackService) {}

  @Mutation()
  @Allow(Permission.Owner)
  async createPaystackPaymentIntent(
    @Ctx() ctx: RequestContext,
    @Args() { input }: { input: PaystackPaymentIntentInput }
  ): Promise<PaystackPaymentIntentResult> {
    if (!ctx.authorizedAsOwnerOnly) {
      throw new UnauthorizedError();
    }

    return this.paystackService.initializeTransaction(ctx, input);
  }

  @Mutation()
  @Allow(Permission.Owner)
  async confirmPaystackPayment(
    @Ctx() ctx: RequestContext,
    @Args() args: { reference: string }
  ): Promise<Order> {
    if (!ctx.authorizedAsOwnerOnly) {
      throw new UnauthorizedError();
    }
    return this.paystackService.confirmPayment(ctx, args.reference);
  }

  @ResolveField()
  @Resolver('PaystackPaymentIntentResult')
  __resolveType(
    value: PaystackPaymentIntentError | PaystackPaymentIntent
  ): string {
    if ((value as PaystackPaymentIntentError).errorCode) {
      return 'PaystackPaymentIntentError';
    } else {
      return 'PaystackPaymentIntent';
    }
  }
}
