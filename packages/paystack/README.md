![Vendure Paystack Plugin](https://raw.githubusercontent.com/MonkishTech/monkish-vendure-plugins/main/assets/vendure-paystack-logo.png)

# Paystack Vendure Plugin

![NPM Version](https://img.shields.io/npm/v/@monkish/vendure-paystack-plugin)

The plugin initializes a Paystack transaction, verifies it, and records a Vendure payment. `confirmPaystackPayment` and the Paystack webhook settle through the same method. The amount Paystack collects and the amount stored on the Vendure payment are separate.

## Installation

```bash
yarn add @monkish/vendure-paystack-plugin
```

## Server setup

Register the plugin:

```ts
import { PaystackPlugin } from '@monkish/vendure-paystack-plugin';

plugins: [PaystackPlugin];
```

Create one payment method in the Dashboard:

1. Choose the **Paystack payments** handler.
2. Set `secretKey` to your Paystack secret key.
3. Select the eligibility checker **Check whether Paystack supports the payment**.

Supported currencies are `NGN`, `USD`, `GHS`, `ZAR`, and `KES`. The plugin uses the first Paystack payment method on the channel.

Set the Paystack webhook URL to `https://<vendure-host>/payments/paystack`. The plugin checks `x-paystack-signature` with that payment method's secret key.

## Checkout

The active order needs a customer and a shipping method, and it must be in `ArrangingPayment`.

1. Call `createPaystackPaymentIntent`.
2. Open [Paystack Popup](https://paystack.com/docs/payments/accept-payments/#popup) with `data.access_code`.
3. On success, call `confirmPaystackPayment` with the transaction reference.

The webhook settles the same charge when confirm does not run. A second confirm or webhook for the same Paystack transaction does not add another payment.

## Amounts

Amounts are minor units of the order currency.

| Field | Meaning |
| --- | --- |
| `chargeAmount` | What Paystack collects. Defaults to the settlement amount. |
| `settlementAmount` | What is written to `Payment.amount`. Defaults to the outstanding balance and cannot exceed it. |
| `paystackAmount` | Deprecated alias of `chargeAmount`. |

`chargeAmount` must be a positive integer and at least the settlement amount. If `chargeAmount` and `paystackAmount` are both set and differ, initialize returns `PaystackPaymentIntentError`. `chargeAmount` is stored on the payment metadata. It is not added to `Payment.amount`.

Omit both amounts. Paystack is charged the outstanding balance, and that balance is recorded.

Pass a processor fee as `chargeAmount` only. For a 4% fee, pass `round(totalWithTax * 1.04)`. Paystack collects the fee. `Payment.amount` stays the outstanding balance.

Pass a deposit as `settlementAmount` below the outstanding balance. Paystack is charged that amount unless you also pass a higher `chargeAmount`. The order stays out of `PaymentSettled` until later settled payments cover `totalWithTax`.

A tip is a surcharge the store adds to the order before initialize. This plugin does not add surcharges. After the surcharge, the outstanding balance includes the tip, and the payment covers that balance.

## Mutations

```graphql
mutation CreatePaystackPaymentIntent($input: PaystackPaymentIntentInput!) {
  createPaystackPaymentIntent(input: $input) {
    __typename
    ... on PaystackPaymentIntent {
      status
      message
      data {
        authorization_url
        access_code
        reference
      }
    }
    ... on PaystackPaymentIntentError {
      errorCode
      message
    }
  }
}

mutation ConfirmPaystackPayment($reference: String!) {
  confirmPaystackPayment(reference: $reference) {
    id
    code
    state
  }
}
```

`channels` restricts the Paystack channels offered to the customer: `card`, `bank`, `ussd`, `qr`, `mobile_money`, `bank_transfer`, `eft`. Omit it to offer the channels enabled on the Paystack dashboard.

`createPaystackPaymentIntent` returns `PaystackPaymentIntentError` when:

- `chargeAmount` and `paystackAmount` differ
- `settlementAmount` is not a positive integer, or it exceeds the outstanding balance
- `chargeAmount` is not a positive integer, or it is below the settlement amount
- the order currency is unsupported
- Paystack rejects the initialize call

`confirmPaystackPayment` throws when the reference is empty, verification fails, the transaction is for a different order, the customer cannot access the order, the verified Paystack amount differs from `charge_amount`, `settlementAmount` now exceeds the outstanding balance, or the outstanding balance is greater than `chargeAmount`. An order that is already `PaymentSettled` returns that order.

Webhook status codes:

| Status | When |
| --- | --- |
| 400 | The signature is missing or invalid. |
| 200 | The charge is settled, already settled, or rejected. |
| 500 | The order cannot be loaded, or the database cannot be reached. Paystack should retry. |

## Refunds

A Vendure refund calls Paystack and is created as `Pending`. The `refund.processed` webhook settles it. `refund.failed` marks it failed. `refund.pending` is acknowledged and leaves the refund pending.

## Upgrade

If the host app declared its own `confirmPaystackPayment` mutation and a service that adds the Paystack payment, delete that mutation and service. This plugin now provides `confirmPaystackPayment`. Storefront queries that select `id`, `code`, and `state` keep working. `paystackAmount` keeps working. New code should send `chargeAmount`.
