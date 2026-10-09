# M-Pesa settlement amounts

Move `vendure-mpesa-plugin` into this repo and apply the same charge-versus-settlement split as the Paystack plugin. This spec covers the package move, the STK amount rules, settlement on the Safaricom callback, and the docs. Tikozetu and the old repository stay as they are.

## Package

The plugin lives at `packages/mpesa` and is published as `@monkish/vendure-mpesa-plugin`, version `0.0.1`. It follows the Paystack package: an Nx library, the shared test utilities, and a changeset. The repo README links it next to Paystack.

Credentials stay on the **Lipa na Mpesa Online** payment method. `MpesaPlugin.init` still only accepts extra STK callback IPs. KES is checked when the STK push starts. There is no eligibility checker.

## Shop API

`initiateMpesaTransaction` keeps `phoneNumber` and gains two optional amounts, both in minor units. The result stays `MpesaTransactionInitiation!` with `success`, `transactionId`, and `message`. A phone-only call still works.

```graphql
initiateMpesaTransaction(
  phoneNumber: String!
  "What M-Pesa collects, in minor units. Defaults to the settlement amount rounded up to the next shilling."
  chargeAmount: Money
  "What is written to Payment.amount. Defaults to the outstanding balance. Cannot exceed it."
  settlementAmount: Money
): MpesaTransactionInitiation!
```

Omitting both amounts charges the outstanding balance rounded up to the next shilling and records that balance. An explicit `chargeAmount` is a positive multiple of 100 and is at least the settlement amount. `settlementAmount`, when passed, is a positive integer no greater than the outstanding balance at initiate time. The STK `Amount` is `chargeAmount / 100`.

The default settlement is the outstanding balance. The default charge is that settlement rounded up to the next shilling: `Math.ceil(settlement / 100) * 100`. A whole-shilling balance is unchanged. A balance of 1001 minor units charges 1100.

`verifyMpesaTransaction` stays a status poll. The callback records the payment.

## Order fields

Initiate writes three internal order fields together, and only after Safaricom accepts the push (`ResponseCode` `"0"`). `mpesaChargeAmount` and `mpesaSettlementAmount` are nullable ints. A failed initiate leaves the previous attempt's fields in place.

| Field | When it is written |
| --- | --- |
| `mpesaCheckoutRequestID` | Always. The Safaricom checkout request id. |
| `mpesaChargeAmount` | Always. Minor units sent as STK shillings. |
| `mpesaSettlementAmount` | Only when the caller passed `settlementAmount`. |

A new accepted STK push overwrites all three. An empty `mpesaSettlementAmount` means “record the outstanding balance.” That path uses `addPaymentToOrder`, so a coupon removed before the callback still changes what is recorded. The balance is not frozen at initiate time.

## Settlement

The callback finds the order by `mpesaCheckoutRequestID` and settles in an admin `RequestContext`. The handler's `createPayment` already rejects a shop context.

On a successful callback (`ResultCode` 0):

1. Return when a payment with this checkout request id already exists. A second callback does not add a payment. `Payment.transactionId` is that id.
2. Read `Amount` from the callback metadata. It may be a number or a numeric string of whole shillings. When `mpesaChargeAmount` is set, `Amount * 100` must equal it. A mismatch, or a missing `Amount`, records nothing. A callback for an order with no stored charge skips that check and records the outstanding balance. Those are pushes accepted before this change.
3. Move the order to `ArrangingPayment` when it is not already there.
4. Call `addPaymentToOrder` when `mpesaSettlementAmount` is empty and the outstanding balance is less than or equal to the charge. If the balance has grown past the charge, record nothing. When `mpesaSettlementAmount` is set, it must still be no greater than the current outstanding balance, and `PaymentService.createPayment` records that amount. Vendure moves the order to `PaymentSettled` only when settled payments cover `totalWithTax`.
5. The handler stores `mpesaReceiptNumber` and, when the charge is a number, `chargeAmount` on the payment metadata. `Payment.amount` is the settlement. The charge is not added to `Payment.amount`. The handler still returns the `amount` argument it is given.

The STK status query stays after the payment is recorded. A failed query is only logged. Daraja's query is often not ready when the callback arrives. The amount check uses the callback `Amount`.

A failed STK push (`ResultCode` other than 0) clears `mpesaCheckoutRequestID`, `mpesaChargeAmount`, and `mpesaSettlementAmount`.

## Errors

**Initiate** returns `success: false` and does not call Safaricom when:

- `settlementAmount` is not a positive integer. This includes a default settlement of zero.
- `settlementAmount` is greater than the outstanding balance
- `chargeAmount` is not a positive integer
- `chargeAmount` is not a multiple of 100 (`chargeAmount must be a whole number of shillings.`)
- `chargeAmount` is less than the settlement amount

The messages for the first, second, third, and fifth cases are:

- `settlementAmount must be a positive integer.`
- `settlementAmount cannot exceed the outstanding balance.`
- `chargeAmount must be a positive integer.`
- `chargeAmount cannot be less than the settlement amount.`

A missing order, a missing customer, a non-KES currency, and a Safaricom failure stay `success: false` with their current messages.

**The callback** answers:

| Status | When |
| --- | --- |
| 403 | The caller IP is not on the allowlist. |
| 200 | The payment is recorded, already recorded, the STK push failed, or settlement is rejected. |
| 500 | A successful callback's order cannot be loaded, or the database cannot be reached. Safaricom should retry. |

A rejected settlement is an amount that does not match `mpesaChargeAmount`, a missing callback `Amount` when a charge was stored, a balance that has grown past the charge, or a `mpesaSettlementAmount` that now exceeds the balance. A failed callback whose checkout request id matches no order stays 200. There is nothing to retry into existence.

## Refunds

A Vendure refund calls the M-Pesa reversal API and is created as `Validating`. The reversal callback settles it when `ResultCode` is `"0"` and marks it `Failed` otherwise.

The reversal `TransactionID` is the payment's `mpesaReceiptNumber`. When the payment metadata has `chargeAmount`, the reversal `Amount` is `chargeAmount / 100` shillings, so a shilling added by rounding is returned. A payment with no `chargeAmount` keeps today's `trunc(payment.amount / 100)`.

## Tests

The existing M-Pesa end-to-end tests move into `packages/mpesa` and keep their current behavior: STK initiation, verification, the success and failure callbacks, reversals, and configuration errors. They use this repo's shared test utilities. New tests cover the amounts.

- A phone-only call sends Safaricom the outstanding balance rounded up to the next shilling, stores `mpesaChargeAmount`, and leaves `mpesaSettlementAmount` empty. The callback records `Payment.amount` as the outstanding balance, stores `chargeAmount` on the payment metadata, and the order reaches `PaymentSettled`.
- `chargeAmount` above that balance is what the STK push sends. The callback still records the outstanding balance.
- `settlementAmount` above the balance, `chargeAmount` below the settlement, and a `chargeAmount` that is not a whole number of shillings return `success: false` and do not call Safaricom.
- An explicit `settlementAmount` below the balance is what the callback records. The order stays out of `PaymentSettled`.
- A second callback for the same checkout request id does not add a payment.
- When the callback `Amount` does not match `mpesaChargeAmount`, or the outstanding balance has grown past the charge, no payment is recorded and the callback answers 200.
- A callback for an order with no stored charge still records the outstanding balance.
- A successful callback whose checkout request id matches no order answers 500.

## Documentation

`packages/mpesa/README.md` is the integration guide. The repo README links it beside Paystack. It does not describe Tikozetu or the old repository's internals.

Sections, in this order:

1. **What it does.** The plugin sends an STK push, and the Safaricom callback records a Vendure payment. `verifyMpesaTransaction` reports whether that payment exists. The shilling amount Safaricom collects and the amount stored on the payment are separate.

2. **Installation.** `yarn add @monkish/vendure-mpesa-plugin`.

3. **Server setup.** Register `MpesaPlugin`. `MpesaPlugin.init` only adds extra callback IPs. Create one payment method with the **Lipa na Mpesa Online** handler and set its credentials, including `vendureHost`. The plugin accepts KES only. Callback URLs are `https://<vendure-host>/daraja/stkpush/callback` and `https://<vendure-host>/daraja/reversal/callback`. The STK callback accepts the Safaricom IP allowlist, plus any extra IPs passed to `init`.

4. **Checkout.** The active order needs a customer and must be in `ArrangingPayment`. The storefront calls `initiateMpesaTransaction` with the phone number. The customer confirms the prompt. The storefront polls `verifyMpesaTransaction` until the status is `SUCCESS` or `FAILED`. A second callback for the same checkout request id does not add another payment.

5. **Amounts.** All amounts are minor units. Document `chargeAmount` and `settlementAmount`, including the defaults and the validation rules in this spec. Include these cases:
   - Omit both amounts. Safaricom is charged the outstanding balance rounded up to the next shilling, and the outstanding balance is recorded.
   - A higher `chargeAmount`, in whole shillings. `Payment.amount` stays the outstanding balance. `chargeAmount` is stored on the payment metadata.
   - A deposit. Pass `settlementAmount` below the balance. Safaricom is charged that amount rounded up to the next shilling, unless `chargeAmount` is higher. The order stays out of `PaymentSettled` until later payments cover `totalWithTax`.
   - A tip is a surcharge the host adds before initiate. The plugin does not add one.

6. **Mutations.** Show `initiateMpesaTransaction` and `verifyMpesaTransaction`, including `success`, `transactionId`, `message`, and the verification statuses `SUCCESS`, `FAILED`, and `PENDING`. Document the initiate failure messages and the callback status codes in this spec.

7. **Refunds.** A Vendure refund calls the M-Pesa reversal API and is created as `Validating`. The reversal callback settles it on `ResultCode` `"0"` and marks it failed otherwise. The reversal amount is the collected charge in shillings when `chargeAmount` is stored.

8. **Upgrade.** Hosts change the dependency from `vendure-mpesa-plugin` to `@monkish/vendure-mpesa-plugin`. A call that passes only `phoneNumber` keeps working. New code can pass `chargeAmount` and `settlementAmount`.

## Out of scope

- Editing Tikozetu, or switching its dependency.
- Deleting, archiving, or unpublishing the old `vendure-mpesa-plugin` repository and npm package.
- The instalments plugin.
- Adding a tip surcharge. The host does that before initiate.
