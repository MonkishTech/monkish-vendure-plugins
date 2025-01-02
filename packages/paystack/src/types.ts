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
export type CurrencyCode = ReturnType<typeof graphql.scalar<'CurrencyCode'>>;

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

export type WebhookEvent = {
  event:
    | 'charge.success'
    | 'paymentrequest.pending'
    | 'paymentrequest.success'
    | 'refund.pending'
    | 'refund.failed'
    | 'refund.processed'
    | 'refund.processing';
};

export type VerificationResponse = {
  status: boolean;
  message: string;
  data: {
    id: number;
    domain: string;
    status: string;
    reference: string;
    receipt_number: string | null;
    amount: number;
    message: string | null;
    gateway_response: string;
    paid_at: string;
    created_at: string;
    channel: string;
    currency: string;
    ip_address: string;
    metadata: string | null;
    log: {
      start_time: number;
      time_spent: number;
      attempts: number;
      errors: number;
      success: boolean;
      mobile: boolean;
      input: unknown[];
      history: {
        type: string;
        message: string;
        time: number;
      }[];
    };
    fees: number;
    fees_split: unknown | null;
    authorization: {
      authorization_code: string;
      bin: string;
      last4: string;
      exp_month: string;
      exp_year: string;
      channel: string;
      card_type: string;
      bank: string;
      country_code: string;
      brand: string;
      reusable: boolean;
      signature: string;
      account_name: string | null;
    };
    customer: {
      id: number;
      first_name: string | null;
      last_name: string | null;
      email: string;
      customer_code: string;
      phone: string | null;
      metadata: unknown | null;
      risk_action: string;
      international_format_phone: string | null;
    };
    plan: unknown | null;
    split: unknown;
    order_id: unknown | null;
    paidAt: string;
    createdAt: string;
    requested_amount: number;
    pos_transaction_data: unknown | null;
    source: unknown | null;
    fees_breakdown: unknown | null;
    connect: unknown | null;
    transaction_date: string;
    plan_object: unknown;
    subaccount: unknown;
  };
};
