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

export type TransactionEvent = WebhookEvent & {
  data: {
    id: number;
    domain: string;
    status: string;
    reference: string;
    amount: number;
    message: string | null;
    gateway_response: string;
    paid_at: string;
    created_at: string;
    channel: string;
    currency: string;
    ip_address: string;
    metadata: number | null;
    fees: number | null;
    customer: {
      id: number;
      first_name: string;
      last_name: string;
      email: string;
      customer_code: string;
      phone: string | null;
      risk_action: string;
    };
    authorization: {
      authorization_code: string;
      bin: string;
      last4: string;
      exp_month: string;
      exp_year: string;
      card_type: string;
      bank: string;
      country_code: string;
      brand: string;
      account_name: string | null;
    };
  };
};

export type RefundEvent = WebhookEvent & {
  data: {
    status: string;
    transaction_reference: string;
    refund_reference: string | null;
    amount: string;
    currency: string;
    processor: string;
    customer: {
      first_name: string;
      last_name: string;
      email: string;
    };
    integration: number;
    domain: string;
  };
};

type PaystackResponse = {
  status: boolean;
  message: string;
};

export type VerificationResponse = PaystackResponse & {
  data: {
    id: number;
    domain: string;
    status: string;
    reference: string;
    amount: number;
    gateway_response: string;
    paid_at: string;
    created_at: string;
    channel: string;
    currency: string;
    ip_address: string;
    fees: number;
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
      risk_action: string;
      international_format_phone: string | null;
    };
    paidAt: string;
    createdAt: string;
    requested_amount: number;
    transaction_date: string;
  };
};

export type RefundResponse = PaystackResponse & {
  data: {
    transaction: {
      id: number;
      domain: string;
      reference: string;
      amount: number;
      paid_at: string;
      channel: string;
      currency: string;
      authorization: {
        exp_month: string | null;
        exp_year: string | null;
        account_name: string | null;
      };
      customer: {
        international_format_phone: string | null;
      };
      subaccount: {
        currency: string | null;
      };
      paidAt: string;
    };
    integration: number;
    deducted_amount: number;
    channel: string | null;
    merchant_note: string;
    customer_note: string;
    status: string;
    refunded_by: string;
    expected_at: string;
    currency: string;
    domain: string;
    amount: number;
    fully_deducted: boolean;
    id: number;
    createdAt: string;
    updatedAt: string;
  };
};
