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

1. Create a Paystack account and get your secret key from the Paystack dashboard.
2. Register the plugin in your Vendure config:

```ts
plugins: [PaystackPlugin.init()];
```

3. In the Admin UI, create one PaymentMethod and select **Paystack payments** as the handler.
4. Set the handler `secretKey` argument to your Paystack secret key.
5. Set the webhook URL in Paystack to `https://my-server.com/payments/paystack`, where `my-server.com` is your Vendure host.

> Be sure to select the 'Check whether Paystack supports the payment' eligibility checker when creating the payment method. Paystack only supports the `NGN`, `USD`, `GHS`, `ZAR` and `KES` currencies.

6. Call the `createPaystackPaymentIntent` mutation on checkout to initialize a transaction and return the access code for use with [Paystack Popup](https://paystack.com/docs/payments/accept-payments/#popup) on the storefront.

### createPaystackPaymentIntent input

- `callbackUrl` (required): Paystack callback URL override.
- `channels` (optional): restrict the available Paystack channels.
- `metadata` (optional): JSON metadata sent to Paystack.
- `paystackAmount` (optional): amount to charge in minor units. This affects only the Paystack charge amount and does not change Vendure order totals.

### Notes

- The plugin is designed for one configured Paystack payment method.
- The webhook signature (`x-paystack-signature`) is validated using the `secretKey` from that configured Paystack payment method.
