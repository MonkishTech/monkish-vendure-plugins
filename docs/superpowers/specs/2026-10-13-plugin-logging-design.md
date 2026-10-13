# Plugin logging

Date: 2026-10-13

Operational logs in M-Pesa, Paystack, and Lipa Mdogo should make a failed payment or a skipped decision diagnosable from one line, at the right Vendure level. This follows the contract in Apago's `docs/superpowers/specs/2026-09-07-plugin-logging-design.md`: response bodies on HTTP failures, no request bodies or headers.

Logging does not change payment, refund, webhook, or plan outcomes. Return values, thrown errors, and HTTP statuses stay as they are. GraphQL `errorMessage` strings stay as they are.

## Non-goals

- No shared logging package and no helper under `utils`.
- No custom `VendureLogger`, PostHog client, or OpenTelemetry setup.
- No new `verbose` logs.
- No README changes.
- No log assertion on the existing plugin end-to-end tests.

## Contract

Each plugin logs through Vendure `Logger` with a stable context string: `MpesaPlugin`, `PaystackPlugin`, and `LipaMdogoPlugin`. Lipa Mdogo gets `loggerCtx` in `packages/lipa-mdogo/src/constants.ts`. M-Pesa and Paystack keep the constants they already export.

One event is one line:

```
<short sentence>: key=value key=value body=<provider body>
```

The sentence names the action and the outcome. Identifiers are `key=value` pairs. Prefer `orderCode` over a numeric order id. Include the external id and status when they exist (`checkoutRequestId`, `transactionId`, `reference`, `httpStatus`, `resultCode`). On an HTTP failure, append the provider response body as returned. Omit `body=` when there is no response payload. Do not redact provider response bodies.

`Logger.error(message, loggerCtx, stack)` takes the stack trace as its third argument. `warn`, `info`, and `debug` take `(message, loggerCtx)` only.

| Level | When |
| --- | --- |
| `error` | Unexpected failure: HTTP error, thrown exception, payment or refund failed, a scheduled task failed for one plan |
| `warn` | The flow can continue, and someone should look: rejected callback, missing payment method, unmatched webhook, skipped because of misconfiguration |
| `info` | A real state change succeeded: payment settled, refund settled, plan completed, plan missed, reminder sent |
| `debug` | Expected skips and reads: duplicate callback, unsupported currency, callback received, refund still pending |
| `verbose` | No new verbose logs |

Never interpolate the Paystack secret key, the M-Pesa consumer key, consumer secret, passkey, or security credential, an `Authorization` header, or an access token. Request bodies and headers are not logged. Inbound callback logs carry the result fields named below, not the raw payload.

## Helpers

M-Pesa and Paystack each get their own copy of `log-provider-error.ts` under `packages/mpesa/src/service/` and `packages/paystack/src/service/`. Lipa Mdogo does not get one. It has no provider HTTP client, and its lines are written at the call site with `buildLogMessage`'s shape.

`buildLogMessage(sentence, identifiers)` joins `<sentence>: key=value key=value`. It drops values that are `null`, `undefined`, or `""`.

`logProviderError(sentence, error, identifiers)` writes one `Logger.error`.

- For an Axios error it reads `response.status` and `response.data` only. The status becomes `httpStatus`. The data becomes `body`: a string stays as-is, any other value is `JSON.stringify`'d. `body` is omitted when `data` is `undefined`.
- It does not call `toJSON()`, and it does not read `config`, request headers, or the request body.
- `error.message` is the `error` identifier when `error` is an `Error`. The third argument is `error.stack` when that stack exists.
- Any other thrown value is logged as `error=<String(value)>` with no stack.

Callers still return or throw the same result, and they do not log that failure again.

`info`, `warn`, and `debug` lines in M-Pesa and Paystack use `buildLogMessage` from that module.

## M-Pesa

| Site | Level | Line |
| --- | --- | --- |
| STK push HTTP failure | `error` via `logProviderError` | `orderCode` and the response body. Remove the second `JSON.stringify` line. |
| STK push HTTP 200 with `ResponseCode !== '0'` | `error` | `orderCode`, `responseCode`, `responseDescription`. |
| STK status HTTP failure | `error` via `logProviderError` | `checkoutRequestId` and the response body. The catch also returns `requestFailed: true` beside the existing `{ isSuccessful: false, message }`. |
| STK query after settlement, HTTP succeeded, result not successful | `warn` | `checkoutRequestId` and `message`. Skip this warn when `requestFailed` is true, so the HTTP error is the only line. |
| Callback IP outside the allowlist | `warn` | `clientIp`. |
| Callback received | `debug` | `checkoutRequestId`, `resultCode`, `resultDesc`. |
| Callback for a payment that already exists | `debug` | `checkoutRequestId`. |
| Customer-failed STK callback | `warn` | One line, after the order lookup. `checkoutRequestId`, `resultCode`, `resultDesc`, and `orderCode` when the order exists. When the order does not exist, that line carries `checkoutRequestId`, `resultCode`, and `resultDesc`. |
| Payment added, both the `addPaymentToOrder` path and the explicit `createPayment` path | `info` | `orderCode`, `receipt`. |
| `MpesaSettleRejection` in `StkPushCallbackController` | `error` | The rejection message, `checkoutRequestId`, and the stack. `handleStkPushCallback` does not log it. |
| No payment on refund | `warn` | `transactionId`. |
| Payment has no M-Pesa receipt | `warn` | `transactionId`. |
| Reversal HTTP failure | `error` via `logProviderError` | `transactionId` and the response body. Remove the second `JSON.stringify` line. |
| Reversal HTTP 200 with `ResponseCode !== '0'` | `error` | `transactionId`, `responseCode`. |
| Reversal callback received | `debug` | `transactionId`, `resultCode`, `resultDesc`. |
| Refund settled | `info` | `transactionId`. The refund query does not load the order, and this change does not add a query for `orderCode`. |
| Refund failed at the provider | `error` | `transactionId`, `resultDesc`. This is `info` today. |
| No refund for that transaction | `warn` | `transactionId`. |
| Auth HTTP failure | `error` via `logProviderError` | Response body only. The sentence tells the operator to check the consumer key, secret, and environment. It does not include those values. Still returns `''`. |
| Payment method missing in `getMpesaConfig` | `error`, then the existing throw | One line. The thrown message stays `Mpesa payment method not found`. |

Remove the `info` line in `getPaymentByTransactionId`. That miss runs on the first callback and on status polls. `reversePayment` already warns when it needs the signal.

## Paystack

Thrown error strings stay as they are, including messages that already embed `[PaystackPlugin]`. Log lines do not repeat that prefix. `buildLogMessage` carries the identifiers instead.

| Site | Level | Line |
| --- | --- | --- |
| More than one Paystack method | `warn` | Method `count`. |
| No method configured, before the existing `UserInputError` | `warn` | One line, then throw the same error. |
| Missing secret key, before each existing throw in `initializeTransaction` and `confirmPayment` | `error` | `paymentMethod` code. The key is not in the line. `createRefund` already returns `Failed` after its log. That return stays. |
| Unsupported currency in the eligibility checker | `debug` | `orderCode`, `currencyCode`. Replace the multiline `info`. |
| Initialize HTTP failure | `error` via `logProviderError` | `orderCode`. Replaces `toJSON()`. |
| Initialize returns a status other than 200 without throwing | `error` | `orderCode`, `httpStatus`, response body, then the existing `PaymentIntentError`. |
| Verify HTTP failure | `error` via `logProviderError` | `reference`. One line. Returns `undefined`, as today. |
| Verify HTTP succeeded and the charge is not successful | `warn` | `reference` and the provider `status`. Returns `undefined`. |
| Refund method mismatch | `error` | `orderCode`, `paymentMethod`, `configuredMethod`. Then the existing `Failed` result. |
| Refund missing secret | `error` | `orderCode`, `paymentMethod`. Then the existing `Failed` result. |
| Refund HTTP failure | `error` via `logProviderError` | `orderCode` and the response body. Remove the second `toJSON()` line. |
| Refund returns a status other than 200 without throwing | `error` | `orderCode`, `httpStatus`, response body, then the existing `Failed` result. |
| Missing or invalid `x-paystack-signature` | `warn` | The response stays `400`. |
| No webhook secret configured | `error` | The response stays `400`. |
| Unhandled webhook event in the controller | `warn` | `event`. The response stays `200`. |
| `PaystackSettleRejection` whose message is `Paystack payment was not successful` | no extra line | `verifyTransaction` already logged the HTTP error or the non-success warn. `handleSuccessfulCharge` still throws, and the controller still responds `200`. |
| Any other `PaystackSettleRejection` on the webhook | `error` | The rejection message, `reference` from the payload when that payload is a transaction event, and the stack. Response stays `200`. |
| `PaystackSettleRejection` in `confirmPayment` | `error` | The rejection message and the stack, then the existing `UserInputError`. |
| Any other webhook exception | `error` | Message and stack. Response stays `500`. |
| Charge settled inside `settleVerifiedCharge`, both the `addPaymentToOrder` path and the explicit `createPayment` path | `info` | `orderCode`, Paystack transaction `id`. |
| Refund webhook, order not found | `warn` | `transactionReference`. Today this returns with no log. |
| No matching Paystack payment, or no pending refund | `warn` | `orderCode`, and `refundReference` when the refund is the thing missing. These are `error` today. |
| `refund.processed` | `info` | `orderCode`, `refundReference`. |
| `refund.failed` | `error` | `orderCode`, `refundReference`. |
| `refund.pending` | `debug` | `orderCode`, `refundReference`. |

`handleRefundEvent` today logs `info` "processed" after every branch, including `refund.failed`. That line moves into the `refund.processed` branch only. `refund.pending` is not the unhandled-event warn.

## Lipa Mdogo

`loggerCtx` is `LipaMdogoPlugin`. There is no `logProviderError`.

| Site | Level | Line |
| --- | --- | --- |
| Order could not be loaded | `warn` | `planId`, `orderId`. |
| Plan completed | `info` | `orderCode`, `planId`. |
| Cancelled order marked missed | `info` | `orderCode`, `planId`. |
| Missed-payment strategy throws | `error` | `orderCode`, `planId`, and the stack. The plan stays `Active`. |
| Plan marked missed | `info` | `orderCode`, `planId`. |
| Reminder sent | `info` | `orderCode`, `planId`, `offsetDays`. |

A plan that is not due yet is not logged.

## Error handling

An Axios failure is logged inside `logProviderError`, then the caller returns or throws what it returns today.

An HTTP 200 that carries a provider failure code is logged at that `if`, then the existing return runs.

Settle rejections are logged in the catch that already handles them, except the Paystack "payment was not successful" rejection, which `verifyTransaction` has already logged.

A shopper confirm that turns a Paystack rejection into `UserInputError` logs that one error, then throws the same `UserInputError`.

An unexpected webhook exception is logged with its stack, then the controller still responds `500`.

Lipa Mdogo logs the strategy error and returns, so the plan is not saved as `Missed`.

`checkTransactionStatus` logs its own HTTP failure. `handleStkPushCallback` warns only when `requestFailed` is not set.

## Testing

Existing plugin tests do not assert on `Logger`. They stay behavior tests. No current test asserts a log string.

Add `log-provider-error.test.ts` next to each helper. Spy on `Logger.error`:

- An Axios-shaped error produces one call. The fixture puts an `Authorization` header and a consumer secret on `error.config`. The message contains the identifiers, `httpStatus`, and the response body. The third argument is the stack. The message contains neither the header value, the consumer secret, nor `config`.
- A plain `Error` produces one call with `error=` and the stack, and no `body=`.
- A response with no `data` omits `body=`.
- `buildLogMessage` drops `null`, `undefined`, and `""`.

Do not snapshot full log lines. Do not add `Logger` spies to the plugin end-to-end tests.

After each plugin, search for `toJSON()`, `JSON.stringify` of an error, and two `Logger.error` calls in the same `catch`.

## Rollout

Work in order: M-Pesa helper and call sites, then Paystack, then Lipa Mdogo. Each package gets a patch changeset:

- `@monkish/vendure-mpesa-plugin`
- `@monkish/vendure-paystack-plugin`
- `@monkish/vendure-lipa-mdogo-plugin`
