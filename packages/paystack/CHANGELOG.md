# @monkish/vendure-paystack-plugin

## 0.0.6

### Patch Changes

- 79fe1b1: Fix refunds

## 0.0.5

### Patch Changes

- b2bb778: Settle a Paystack charge once when checkout confirmation and the webhook overlap.

## 0.0.4

### Patch Changes

- 5259a47: Allow a Paystack charge to differ from the settled payment. Pass `settlementAmount` for a partial payment, or a higher `chargeAmount` when Paystack should collect more than the outstanding balance. `paystackAmount` remains as a deprecated alias of `chargeAmount`.

## 0.0.3

### Patch Changes

- 1dd28a4: Unset transaction reference code to allow same order retries

## 0.0.2

### Patch Changes

- 57176e5: Support `amount` override
  Make `secretKey` configurable as a payment method handler argument

## 0.0.1

### Patch Changes

- a77b6a4: Initial release. Support payment and refund flows.
