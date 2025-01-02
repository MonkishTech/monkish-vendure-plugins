import { initGraphQLTada, ResultOf, VariablesOf } from 'gql.tada';
import type { introspection } from './generated/vendure';
import { CreatePaystackPaymentIntentMutation } from './graphql/operations';

export const graphql = initGraphQLTada<{
  introspection: typeof introspection;
  scalars: {
    String: string;
    DateTime: string;
    Money: number;
    JSON: Record<string, string>;
  };
}>();

export type ErrorCode = ReturnType<typeof graphql.scalar<'ErrorCode'>>;

export type PaystackPaymentIntentInput = VariablesOf<
  typeof CreatePaystackPaymentIntentMutation
>['input'];

export type PaystackPaymentIntentResult = ResultOf<
  typeof CreatePaystackPaymentIntentMutation
>['createPaystackPaymentIntent'];

export type PaystackPaymentIntent = Extract<
  PaystackPaymentIntentResult,
  { data: unknown }
>;

export type PaystackPaymentIntentError = Extract<
  PaystackPaymentIntentResult,
  { errorCode: unknown }
>;
