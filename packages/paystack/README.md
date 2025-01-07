![Vendure Paystack Plugin](https://raw.githubusercontent.com/MonkishTech/monkish-vendure-plugins/main/assets/vendure-paystack-logo.png)

# Paystack Vendure Plugin

![GitHub Actions Workflow Status](https://img.shields.io/github/actions/workflow/status/MonkishTech/monkish-vendure-plugins/ci.yml)
&nbsp; ![NPM Version](https://img.shields.io/npm/v/@monkish/vendure-paystack-plugin)

Enable payments through [Paystack](https://paystack.com/).

## Installation

```bash
yarn add @monkish/vendure-paystack-plugin
```

## Usage

1. You will need to create a Paystack account and get your secret key in the dashboard.
2. Set the webhook URL in the Paystack dashboard to `https://my-server.com/paystack/webhook`, where `my-server.com` is the host of your Vendure server.
3. Create a new PaymentMethod in the Admin UI, and select "Paystack payments" as the handler.

> Be sure to select the 'Check whether Paystack supports the payment' eligibility checker when creating the payment method. Paystack only supports the `NGN`, `USD`, `GHS`, `ZAR` and `KES` currencies.

4. Call the `createPaystackPaymentIntent` mutation on checkout to initialize a transaction and return the access code for use with [Paystack Popup](https://paystack.com/docs/payments/accept-payments/#popup) on the storefront.
