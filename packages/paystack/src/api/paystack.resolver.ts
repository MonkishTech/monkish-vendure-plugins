import { Args, Mutation, ResolveField, Resolver } from '@nestjs/graphql';
import {
  Allow,
  Ctx,
  Permission,
  RequestContext,
  UnauthorizedError,
} from '@vendure/core';
import { PaystackService } from 'src/service/paystack.service';
import {
  PaystackPaymentIntent,
  PaystackPaymentIntentError,
  PaystackPaymentIntentInput,
  PaystackPaymentIntentResult,
} from 'src/types';

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
