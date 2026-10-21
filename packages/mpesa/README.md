![Vendure M-Pesa Plugin](https://raw.githubusercontent.com/MonkishTech/monkish-vendure-plugins/main/assets/vendure-mpesa-logo.png)

# M-Pesa Vendure Plugin

![NPM Version](https://img.shields.io/npm/v/@monkish/vendure-mpesa-plugin)

The plugin sends an M-Pesa STK push, and the Safaricom callback records a Vendure payment. `verifyMpesaTransaction` reports whether that payment exists. The shilling amount Safaricom collects and the amount stored on the payment are separate.

## Installation

```bash
yarn add @monkish/vendure-mpesa-plugin
```

## Server setup

Register the plugin:

```ts
import { MpesaPlugin } from '@monkish/vendure-mpesa-plugin';

plugins: [MpesaPlugin];
```

`MpesaPlugin.init` only adds extra STK callback IPs, for example `MpesaPlugin.init({ stkPushCallbackAdditionalIps: ['127.0.0.1'] })`.

Create one payment method in the Dashboard:

1. Choose the **Lipa na Mpesa Online** handler.
2. Set the Daraja credentials: `consumerKey`, `consumerSecret`, `environment` (`sandbox` or `live`), `passkey`, `shortCode`, `shortCodeType` (`paybill` or `till`), `initiatorName`, `initiatorPassword`, `apiCertificate`, and `vendureHost`.

The plugin accepts KES only. It checks the order currency when the STK push starts.

`vendureHost` is the public Vendure origin. Safaricom calls `https://<vendure-host>/daraja/stkpush/callback` and `https://<vendure-host>/daraja/reversal/callback`. The STK callback accepts Safaricom's IP allowlist, plus any extra IPs passed to `init`.

## Checkout

The active order needs a customer and must be in `ArrangingPayment`.

1. Call `initiateMpesaTransaction` with the customer's phone number.
2. The customer confirms the STK prompt.
3. Either open `GET /mpesa/transactions/<transactionId>/events` or poll `verifyMpesaTransaction` until `status` is `SUCCESS` or `FAILED`. A client may do both. The stream is the push path. Polling remains valid on its own and is the fallback when the stream drops or closes with no event.

The callback records the payment. A second callback for the same checkout request id does not add another payment.

## Amounts

Amounts are minor units of the order currency. Safaricom collects whole shillings, so the charge is rounded up to the next shilling. `Payment.amount` is never larger than the outstanding balance, and it is never larger than the shillings collected.

| Field | Meaning |
| --- | --- |
| `chargeAmount` | What M-Pesa collects, in minor units. Defaults to the settlement amount rounded up to the next shilling. Must be a positive multiple of 100. |
| `settlementAmount` | What is written to `Payment.amount`. Defaults to the outstanding balance and cannot exceed it. |

Omit both amounts. Safaricom is charged the outstanding balance rounded up to the next shilling, and that balance is recorded. A KES 10.01 order charges 11 shillings. `Payment.amount` stays the outstanding balance. The extra shilling is `chargeAmount` on the payment metadata.

Pass a higher `chargeAmount` in whole shillings when the collected amount should exceed the settlement. `Payment.amount` stays the outstanding balance.

Pass a deposit as `settlementAmount` below the outstanding balance. Safaricom is charged that amount rounded up to the next shilling, unless `chargeAmount` is higher. The order stays out of `PaymentSettled` until later settled payments cover `totalWithTax`.

A tip is a surcharge the store adds to the order before initiate. This plugin does not add surcharges.

## Mutations

```graphql
mutation InitiateMpesaTransaction($phoneNumber: String!, $chargeAmount: Money, $settlementAmount: Money) {
  initiateMpesaTransaction(
    phoneNumber: $phoneNumber
    chargeAmount: $chargeAmount
    settlementAmount: $settlementAmount
  ) {
    success
    transactionId
    message
  }
}

mutation VerifyMpesaTransaction($transactionId: String!) {
  verifyMpesaTransaction(transactionId: $transactionId) {
    status
    transactionId
    message
  }
}
```

`verifyMpesaTransaction.status` is `SUCCESS`, `FAILED`, or `PENDING`.

`initiateMpesaTransaction` returns `success: false` when:

- there is no active order (`No active order found for session`)
- the order has no customer
- the currency is not KES (`Mpesa only supports KES currency`)
- `settlementAmount` is not a positive integer, or it exceeds the outstanding balance
- `chargeAmount` is not a positive integer, is not a whole number of shillings, or is below the settlement amount
- Safaricom rejects the STK push

Callback status codes:

| Status | When |
| --- | --- |
| 403 | The caller IP is not on the allowlist. |
| 200 | The payment is recorded, already recorded, the STK push failed, or settlement is rejected. |
| 500 | A successful callback's order cannot be loaded, or the database cannot be reached. Safaricom should retry. |

## Payment status stream

`GET /mpesa/transactions/<transactionId>/events` is a server-sent event stream. Send the shop session cookie (`EventSource` with credentials from another origin) or the same bearer token the shop API accepts.

A signed-in customer can open the stream for a checkout on their own order. An anonymous session can open it when that checkout belongs to the session's active order. `setCustomerForOrder` does not create a user, so guest checkout is authorized by the active order.

The event name is `mpesa-payment`. The data is the terminal `verifyMpesaTransaction` payload (`SUCCESS` or `FAILED`). The stream then closes. `PENDING` is not sent. If the payment is already recorded when the stream opens, the server sends `SUCCESS` immediately.

A stream opened after a failed callback cleared the checkout id responds `403`. Call `verifyMpesaTransaction` for that `FAILED` result. `401` means there is no shop session. `403` means this session does not own the checkout. `503` means the status bus could not subscribe.

The server sends a `: ping` comment every 15 seconds. It closes the stream with no event after `paymentStatusStreamTimeoutMs` (default 120000).

One Vendure process can use the default in-memory bus. More than one process needs Redis pub/sub. Pass the same connection settings used by `BullMQJobQueuePlugin`. The plugin does not use the job queue for this.

```ts
import { VendureConfig } from '@vendure/core';
import { BullMQJobQueuePlugin } from '@vendure/job-queue-plugin/package/bullmq';
import {
  MpesaPlugin,
  RedisMpesaPaymentStatusBus,
} from '@monkish/vendure-mpesa-plugin';

const connection = { host: 'redis', port: 6379 };

export const config: VendureConfig = {
  plugins: [
    BullMQJobQueuePlugin.init({ connection }),
    MpesaPlugin.init({
      paymentStatusBus: new RedisMpesaPaymentStatusBus({ connection }),
    }),
  ],
};
```

Install the optional peer when you use that adapter: `yarn add ioredis`.

## Refunds

A Vendure refund calls the M-Pesa reversal API and is created as `Validating`. The reversal callback settles it when `ResultCode` is `"0"` and marks it failed otherwise. The reversal amount is the collected charge in shillings when `chargeAmount` is stored on the payment, so a shilling added by rounding is returned.

## Upgrade

Change the dependency from `vendure-mpesa-plugin` to `@monkish/vendure-mpesa-plugin`. A call that passes only `phoneNumber` keeps working. New code can pass `chargeAmount` and `settlementAmount`.
