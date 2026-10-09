# Paystack settlement amounts

Phase 1 of instalment payments. This spec covers the Paystack plugin and its README. The instalments plugin, the M-Pesa plugin, and tip surcharges in host apps come later.

## Problem

Tikozetu and Gecotribe each contain a `SettlePaystackPaymentService` and a shop mutation `confirmPaystackPayment`. That logic belongs in the Paystack plugin. The plugin also assumes a charge covers the outstanding order balance. A deposit cannot be recorded, and a Paystack charge that includes a processor fee is easy to confuse with the amount stored on the Vendure payment.

Two amounts are different kinds of money:

- A processor fee is collected by Paystack and is not part of the order. Tikozetu charges `round(totalWithTax * 1.04)` and records only the outstanding balance, so Vendure payments reconcile with order totals.
- A tip is order money. The host adds it as a surcharge before calling the plugin, which raises `totalWithTax`. This plugin does not add surcharges.
- A deposit is order money below the outstanding balance. The order stays unpaid until later payments cover `totalWithTax`.

## Shop API

`confirmPaystackPayment` returns `Order!` with `id`, `code`, and `state`. Tikozetu and Gecotribe already query that shape. A union result would break those queries. On upgrade, each host deletes its own `confirmPaystackPayment` field. The schema can declare it only once.

```graphql
input PaystackPaymentIntentInput {
  callbackUrl: String!
  "What Paystack collects, in minor units. Defaults to the settlement amount."
  chargeAmount: Money
  "What is written to Payment.amount. Defaults to the outstanding balance. Cannot exceed it."
  settlementAmount: Money
  paystackAmount: Money @deprecated(reason: "Use chargeAmount.")
  channels: [PaystackPaymentChannel!]
  metadata: JSON
}

extend type Mutation {
  createPaystackPaymentIntent(input: PaystackPaymentIntentInput!): PaystackPaymentIntentResult!
  confirmPaystackPayment(reference: String!): Order!
}
```

`chargeAmount` is `chargeAmount ?? paystackAmount`. If both are set and they differ, initialize fails. When `chargeAmount` is omitted, Paystack is charged the settlement amount. The settlement amount used for that default is the caller’s `settlementAmount`, or the outstanding balance when the caller omitted it.

`settlementAmount`, when passed, is a positive integer no greater than the outstanding balance at initialize time. `chargeAmount` is a positive integer no less than that settlement amount. The plugin never records money Paystack did not collect.

Tikozetu’s fee is unchanged: omit `settlementAmount`, and pass `chargeAmount` (or the deprecated `paystackAmount`) as `round(totalWithTax * 1.04)`.

## Metadata

Initialize writes Paystack transaction metadata next to the existing `order_code` key:

| Key | When it is written |
| --- | --- |
| `charge_amount` | Always. The amount sent to Paystack. |
| `settlement_amount` | Only when the caller passed `settlementAmount`. |

Absence of `settlement_amount` means “settle the outstanding balance when the payment is recorded.” That path uses `addPaymentToOrder`, so coupon revalidation still runs. Freezing the balance at initialize time would record a stale amount if a coupon were removed before payment.

Confirm and the webhook read these values from the verified Paystack transaction. The client cannot choose a different amount later.

## Settlement

`PaystackService` has one settle method. The shop resolver and the webhook controller authenticate the caller and then call it. Settle runs in an admin `RequestContext`. The Paystack handler’s `createPayment` already rejects a shop context.

**Confirm** loads the active order in the shop session, verifies the reference with Paystack, and checks that metadata `order_code` matches that order.

**The webhook** handles `charge.success` the same way and finds the order by `order_code`. It has no shop session.

Settle then:

1. Returns the order when it is already `PaymentSettled`.
2. Returns the order when a payment with this Paystack transaction id already exists. Confirm and the webhook can both arrive. The second call does not add a payment.
3. Stops without recording a payment when the verified Paystack amount differs from `charge_amount`. Transactions created before this change have no `charge_amount`. Those keep today’s behavior and settle the outstanding balance.
4. Moves the order to `ArrangingPayment` when it is not already there.
5. Calls `addPaymentToOrder` when `settlement_amount` is absent and the outstanding balance is less than or equal to `charge_amount`. If the balance is greater than `charge_amount`, settle rejects and does not record a payment. A legacy transaction with no `charge_amount` skips that comparison and calls `addPaymentToOrder`. When `settlement_amount` is present, it must still be no greater than the current outstanding balance, and `PaymentService.createPayment` records that amount. Vendure moves the order to `PaymentSettled` only when settled payments cover `totalWithTax`.
6. Stores `chargeAmount` on the payment metadata, beside `transactionId`. `Payment.amount` is the settlement. The charge is not added to `Payment.amount`. Idempotency uses the Paystack transaction id stored as `Payment.transactionId`.

The handler still returns the `amount` argument it is given and still settles only from the admin API. It copies `chargeAmount` from the metadata argument onto the payment metadata. A settle rejection in step 3 or step 5 is the confirm error and the webhook 200 described below.

## Errors

**Initialize** returns the existing `PaystackPaymentIntentError` when:

- `chargeAmount` and `paystackAmount` are both set and differ
- `settlementAmount` is not a positive integer, or it is greater than the outstanding balance
- `chargeAmount` is not a positive integer, or it is less than the settlement amount
- the currency is unsupported, or Paystack rejects the initialize call

A missing secret key stays an internal error. That is a configuration mistake.

**Confirm** returns `Order!` and throws `UserInputError` when the reference is empty, there is no active order, verification fails, `order_code` does not match the active order, the verified charge does not match `charge_amount`, `settlement_amount` is now above the outstanding balance, or the outstanding balance is greater than `charge_amount`. An order that is already `PaymentSettled`, or a payment that already has this transaction id, returns the order.

**The webhook** rejects a missing or invalid signature with 400. A settle rejection, including an amount mismatch, a `settlement_amount` that now exceeds the balance, and metadata with no `order_code`, is logged and answered with 200. Paystack retrying will not make that charge valid. The customer sees the error from confirm. If the order cannot be loaded, or the database cannot be reached, the webhook answers 500 so Paystack retries.

## Tests

Tests stay in the existing `PaystackPlugin` end-to-end suite, with Paystack mocked. The current initialize and webhook-signature tests stay. `paystackAmount` still sends that amount to Paystack.

- A caller that sets only `chargeAmount` above the order total gets that amount in the Paystack initialize body. Confirm records `Payment.amount` as the outstanding balance and stores `chargeAmount` on the payment metadata. The order reaches `PaymentSettled`.
- `paystackAmount` does the same. Sending both with different values returns `PaystackPaymentIntentError`.
- `settlementAmount` above the outstanding balance, or `chargeAmount` below the settlement amount, returns `PaystackPaymentIntentError` and does not call Paystack.
- An explicit `settlementAmount` below the balance is what confirm records. The order does not reach `PaymentSettled`.
- Confirm and the webhook for one Paystack transaction id create one payment. The second call returns the order.
- When the verified Paystack amount differs from `charge_amount`, confirm throws and no payment is recorded. The webhook answers 200.
- When `settlement_amount` is absent and the outstanding balance is greater than `charge_amount`, confirm throws and no payment is recorded. The webhook answers 200.
- A transaction with no `charge_amount` in metadata still settles the outstanding balance.

## Documentation

`packages/paystack/README.md` is rewritten in this change. It keeps the logo and the status badges. It is the integration guide for a store that installs the plugin. It does not describe Tikozetu, Gecotribe, or the instalments plugin.

The README must correct `PaystackPlugin.init()`. The class has no `init` method. Registration is `plugins: [PaystackPlugin]`.

Sections, in this order:

1. **What it does.** The plugin initializes a Paystack transaction, verifies it, and records a Vendure payment. The webhook and `confirmPaystackPayment` share that settlement. Money collected by Paystack and money recorded on the order are separate amounts.

2. **Installation.** `yarn add @monkish/vendure-paystack-plugin`.

3. **Server setup.** Register `PaystackPlugin`. Create one payment method with the **Paystack payments** handler and set `secretKey`. Select the eligibility checker **Check whether Paystack supports the payment**. Supported currencies are `NGN`, `USD`, `GHS`, `ZAR`, and `KES`. The plugin expects one Paystack payment method. Set the Paystack webhook URL to `https://<vendure-host>/payments/paystack`. The webhook checks `x-paystack-signature` with that method’s secret key.

4. **Checkout.** The active order needs a customer and a shipping method, then `ArrangingPayment`. The storefront calls `createPaystackPaymentIntent`, opens [Paystack Popup](https://paystack.com/docs/payments/accept-payments/#popup) with `access_code`, and on success calls `confirmPaystackPayment` with the transaction reference. The webhook settles the same charge if confirm does not run. A second confirm or webhook for the same Paystack transaction does not add another payment.

5. **Amounts.** All amounts are minor units. Document `chargeAmount`, `settlementAmount`, and deprecated `paystackAmount`, including the defaults and the validation rules in this spec. Include these cases:
   - Omit both amounts. Paystack is charged the outstanding balance and that balance is recorded.
   - A processor fee. Pass `chargeAmount` above the balance, for example `round(totalWithTax * 1.04)`. `Payment.amount` stays the outstanding balance. `chargeAmount` is stored on the payment metadata for reconciliation.
   - A deposit. Pass `settlementAmount` below the balance. Paystack is charged that amount unless `chargeAmount` is higher. The order stays out of `PaymentSettled` until later payments cover `totalWithTax`.
   - A tip is a surcharge the host adds before initialize. The plugin does not add one.

6. **Mutations.** Show `createPaystackPaymentIntent` and `confirmPaystackPayment`, including `PaystackPaymentIntent`, `PaystackPaymentIntentError`, and the `Order` fields `id`, `code`, and `state`. List `channels`: `card`, `bank`, `ussd`, `qr`, `mobile_money`, `bank_transfer`, `eft`. Document the initialize error messages and the confirm `UserInputError` cases from this spec. State the webhook status codes: 400 for a bad signature, 200 for a settle rejection, 500 when the order cannot be loaded or the database cannot be reached.

7. **Refunds.** A Vendure refund calls Paystack and is created as `Pending`. The `refund.processed` webhook settles it. `refund.failed` marks it failed. `refund.pending` is acknowledged and leaves the refund pending.

8. **Upgrade.** Hosts that copied `SettlePaystackPaymentService` and declared their own `confirmPaystackPayment` delete that mutation and service. The plugin now provides the mutation. Existing storefront queries that select `id`, `code`, and `state` keep working. `paystackAmount` keeps working and is deprecated in favor of `chargeAmount`.

## Out of scope

- Deleting `SettlePaystackPaymentService` and the host `confirmPaystackPayment` mutation in Tikozetu and Gecotribe. That is the upgrade step in those apps, and it is not part of this package’s tests.
- Adding a tip surcharge. The host does that before initialize.
- The M-Pesa plugin and the instalments plugin.
