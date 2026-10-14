import nock from 'nock';
import path from 'path';
import { rm } from 'node:fs/promises';
import gqlTag from 'graphql-tag';
import {
  CurrencyCode,
  InitialData,
  OrderService,
  RequestContextService,
} from '@vendure/core';
import {
  createTestEnvironment,
  registerInitializer,
  SimpleGraphQLClient,
  SqljsInitializer,
} from '@vendure/testing';
import { MpesaPlugin } from './mpesa.plugin';
import {
  initialData,
  testConfig,
  addItem,
  getCustomerList,
  updateChannel,
  getActiveChannel,
} from '~utils';
import { SANDBOX_BASE_URL, STK_PUSH_CALLBACK_ENDPOINT } from './constants';

const API_PORT = 3050;
const TEST_DB_DIR = path.join(__dirname, '../__test_db__');
const API_CERTIFICATE = `-----BEGIN CERTIFICATE-----
MIIDCzCCAfOgAwIBAgIUKPxBilHEHcuRBENj8GqZA/5rGPYwDQYJKoZIhvcNAQEL
BQAwFTETMBEGA1UEAwwKbXBlc2EtdGVzdDAeFw0yNjAzMDIyMjQzNTRaFw0zNjAy
MjgyMjQzNTRaMBUxEzARBgNVBAMMCm1wZXNhLXRlc3QwggEiMA0GCSqGSIb3DQEB
AQUAA4IBDwAwggEKAoIBAQDgELxL3hxxMT0zxL18Uqx+L9GCSEvAtLtFHLN0ptxl
QImAfiWDL3HL/2KeDdrYivdpcEE7pq0LsiiNDIRT64cIPqqbjLiFmE3MOnvuCT4F
IMfES1sCjaHhISRHkAqU/dN1jBIvol6I1IL/G/BzydtPxdw9wC3vD2irgPxTCmsk
zjvQvxGIgc3O550j++FMz5HyWFXjSxYiA2fMkogkk87olGzR7qWAhGC/ZR6EMwI2
vmealnvr+AzF62Snu6Q5FUm/BHVk8yndeykbGTXLjDmPnO08+1k83npqso45rJ4q
w1bq9JqGABsW4l7zirxxUJ2zS+EW3FW0ZfUkEm/B83NJAgMBAAGjUzBRMB0GA1Ud
DgQWBBTNaikZ20c8cUWt83f7ZPqnB3HIpzAfBgNVHSMEGDAWgBTNaikZ20c8cUWt
83f7ZPqnB3HIpzAPBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQAd
naAqnNKhIdZLdauYCD3pFRPypUS6x4eV87iPe4cJal5eD1UwqW+BpFKJSCDkM1EX
QPGQNh7MseHIRUq4XgVAMelhjj20tNKrIWiSPcePxjJmaLp7hITzOwUJrjCS3qI5
FkqPYpWxor12p5g6R4rIipzFbTpC89mMnMpVwQNgL0FaKv4uLBi1unHen3H8yh4O
XYd5fL/16mFMBSp8rWGouPpT1jtXyotacdlqAdpCHjgbTXYC6c6fRZBeqtbibRPL
gk3Ln3jDF4MkhQ9dwL+ZFYuwlG3KYUAeCvpZwrWufpLyEwG0Vtt6DFPeDj3quhCR
TKqA/+tq2Yk5jqvNtAP7
-----END CERTIFICATE-----`;

const mpesaTestInitialData: InitialData = {
  ...initialData,
  paymentMethods: [
    {
      name: 'mpesa',
      handler: {
        code: 'mpesa',
        arguments: [
          { name: 'consumerKey', value: 'test_consumer_key' },
          { name: 'consumerSecret', value: 'test_consumer_secret' },
          { name: 'environment', value: 'sandbox' },
          { name: 'passkey', value: 'test_passkey' },
          { name: 'shortCode', value: '174379' },
          { name: 'shortCodeType', value: 'paybill' },
          { name: 'initiatorName', value: 'test_initiator' },
          { name: 'initiatorPassword', value: 'test_initiator_password' },
          { name: 'apiCertificate', value: API_CERTIFICATE },
          { name: 'vendureHost', value: `http://localhost:${API_PORT}` },
        ],
      },
    },
  ],
};

const Initiate = gqlTag`
  mutation Initiate(
    $phoneNumber: String!
    $chargeAmount: Money
    $settlementAmount: Money
  ) {
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
`;

const Verify = gqlTag`
  mutation Verify($transactionId: String!) {
    verifyMpesaTransaction(transactionId: $transactionId) {
      status
      transactionId
      message
    }
  }
`;

const ActiveOrderForMpesa = gqlTag`
  query ActiveOrderForMpesa {
    activeOrder {
      id
      code
      state
      totalWithTax
    }
    eligibleShippingMethods {
      id
    }
  }
`;

const OrderPayments = gqlTag`
  query OrderPayments($id: ID!) {
    order(id: $id) {
      state
      payments {
        amount
        state
        transactionId
        metadata
      }
    }
  }
`;

describe('Mpesa Plugin', () => {
  const { server, adminClient, shopClient } = createTestEnvironment({
    ...testConfig(API_PORT),
    plugins: [
      MpesaPlugin.init({
        stkPushCallbackAdditionalIps: ['127.0.0.1', '::1'],
      }),
    ],
  });

  let customer: Awaited<
    ReturnType<typeof getCustomerList>
  >['customers']['items'][number];

  beforeAll(async () => {
    registerInitializer('sqljs', new SqljsInitializer(TEST_DB_DIR));
    await server.init({
      productsCsvPath: path.join(
        __dirname,
        '../../../utils/src/e2e/products.csv'
      ),
      initialData: mpesaTestInitialData,
      customerCount: 2,
    });
    await adminClient.asSuperAdmin();
    customer = (await getCustomerList(adminClient, { take: 2 })).customers
      .items[0] as typeof customer;
    const activeChannel = await getActiveChannel(shopClient);
    await updateChannel(adminClient, {
      id: activeChannel.id,
      defaultCurrencyCode: CurrencyCode.KES,
      availableCurrencyCodes: [CurrencyCode.KES, CurrencyCode.USD],
    });
  }, 120000);

  afterAll(async () => {
    await server.destroy();
    await rm(TEST_DB_DIR, { recursive: true });
  });

  beforeEach(() => {
    nock.cleanAll();
    nock(SANDBOX_BASE_URL)
      .persist()
      .get(/\/oauth\/v1\/generate/)
      .reply(200, { access_token: 'test_access_token', expires_in: '3599' });
  });

  async function arrangeArrangingPayment(
    client: SimpleGraphQLClient
  ): Promise<{ id: string; code: string; totalWithTax: number }> {
    await client.asUserWithCredentials(customer.emailAddress, 'test');
    const before = await client.query(ActiveOrderForMpesa);
    if (before.activeOrder?.state === 'ArrangingPayment') {
      return {
        id: before.activeOrder.id,
        code: before.activeOrder.code,
        totalWithTax: before.activeOrder.totalWithTax,
      };
    }
    if (!before.activeOrder) {
      await addItem(client, 1, 1);
    }
    await client.query(gqlTag`
      mutation {
        setOrderShippingAddress(
          input: {
            fullName: "Ada Lovelace"
            streetLine1: "1 Market Street"
            city: "Nairobi"
            postalCode: "00100"
            countryCode: "KE"
          }
        ) {
          ... on Order {
            id
          }
        }
      }
    `);
    const withMethods = await client.query(ActiveOrderForMpesa);
    const shippingMethodId = withMethods.eligibleShippingMethods[0].id;
    await client.query(
      gqlTag`
        mutation SetShipping($ids: [ID!]!) {
          setOrderShippingMethod(shippingMethodId: $ids) {
            ... on Order {
              id
            }
          }
        }
      `,
      { ids: [shippingMethodId] }
    );
    const transitioned = await client.query(gqlTag`
      mutation {
        transitionOrderToState(state: "ArrangingPayment") {
          ... on Order {
            id
            code
            state
            totalWithTax
          }
          ... on OrderStateTransitionError {
            errorCode
            message
          }
        }
      }
    `);
    const order = transitioned.transitionOrderToState;
    if (order.state !== 'ArrangingPayment') {
      throw new Error(order.message ?? 'Order did not reach ArrangingPayment');
    }
    return { id: order.id, code: order.code, totalWithTax: order.totalWithTax };
  }

  async function arrangeAddingItems(
    client: SimpleGraphQLClient
  ): Promise<{ id: string; code: string; totalWithTax: number }> {
    await client.asUserWithCredentials(customer.emailAddress, 'test');
    const before = await client.query(ActiveOrderForMpesa);
    if (!before.activeOrder) {
      await addItem(client, 1, 1);
    }
    await client.query(gqlTag`
      mutation {
        setOrderShippingAddress(
          input: {
            fullName: "Ada Lovelace"
            streetLine1: "1 Market Street"
            city: "Nairobi"
            postalCode: "00100"
            countryCode: "KE"
          }
        ) {
          ... on Order {
            id
          }
        }
      }
    `);
    const withMethods = await client.query(ActiveOrderForMpesa);
    const shippingMethodId = withMethods.eligibleShippingMethods[0].id;
    await client.query(
      gqlTag`
        mutation SetShipping($ids: [ID!]!) {
          setOrderShippingMethod(shippingMethodId: $ids) {
            ... on Order {
              id
            }
          }
        }
      `,
      { ids: [shippingMethodId] }
    );
    const ready = await client.query(ActiveOrderForMpesa);
    return {
      id: ready.activeOrder.id,
      code: ready.activeOrder.code,
      totalWithTax: ready.activeOrder.totalWithTax,
    };
  }

  async function cancelActiveOrder(client: SimpleGraphQLClient) {
    await client.query(gqlTag`
      mutation {
        transitionOrderToState(state: "Cancelled") {
          ... on Order {
            state
          }
        }
      }
    `);
  }

  async function setCheckoutRequestId(
    orderId: string,
    checkoutRequestId: string | null
  ) {
    const orderService = server.app.get(OrderService);
    const requestContextService = server.app.get(RequestContextService);
    const ctx = await requestContextService.create({ apiType: 'admin' });
    const id = Number.parseInt(orderId.replace(/^T_/, ''), 10);
    await orderService.updateCustomFields(ctx, id, {
      mpesaCheckoutRequestID: checkoutRequestId,
    });
  }

  async function postCallback(
    payload: unknown,
    headers: Record<string, string> = {}
  ) {
    return shopClient.fetch(
      `http://localhost:${API_PORT}/${STK_PUSH_CALLBACK_ENDPOINT}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(payload),
      }
    );
  }

  function successCallback(
    checkoutRequestId: string,
    amountShillings: number,
    receipt: string
  ) {
    return {
      Body: {
        stkCallback: {
          MerchantRequestID: '29115-34620561-1',
          CheckoutRequestID: checkoutRequestId,
          ResultCode: 0,
          ResultDesc: 'The service request is processed successfully.',
          CallbackMetadata: {
            Item: [
              { Name: 'Amount', Value: String(amountShillings) },
              { Name: 'MpesaReceiptNumber', Value: receipt },
            ],
          },
        },
      },
    };
  }

  function captureStk(checkoutRequestId: string) {
    let body: { Amount?: number } | undefined;
    nock(SANDBOX_BASE_URL)
      .post('/mpesa/stkpush/v1/processrequest', (captured) => {
        body = captured as { Amount?: number };
        return true;
      })
      .reply(200, {
        MerchantRequestID: '29115-34620561-1',
        CheckoutRequestID: checkoutRequestId,
        ResponseCode: '0',
        ResponseDescription: 'Success. Request accepted for processing',
        CustomerMessage: 'ok',
      });
    return () => body;
  }

  async function readMpesaFields(orderId: string) {
    const orderService = server.app.get(OrderService);
    const requestContextService = server.app.get(RequestContextService);
    const ctx = await requestContextService.create({ apiType: 'admin' });
    const id = Number.parseInt(orderId.replace(/^T_/, ''), 10);
    const order = await orderService.findOne(ctx, id);
    if (!order) {
      throw new Error(`Order ${orderId} was not found`);
    }
    const fields = order.customFields as {
      mpesaCheckoutRequestID: string | null;
      mpesaChargeAmount?: number | null;
      mpesaSettlementAmount?: number | null;
    };
    return {
      mpesaCheckoutRequestID: fields.mpesaCheckoutRequestID,
      mpesaChargeAmount: fields.mpesaChargeAmount ?? null,
      mpesaSettlementAmount: fields.mpesaSettlementAmount ?? null,
    };
  }

  function roundUpToShilling(minor: number) {
    return Math.ceil(minor / 100) * 100;
  }

  function mockStkQuery(checkoutRequestId: string) {
    nock(SANDBOX_BASE_URL).post('/mpesa/stkpushquery/v1/query').reply(200, {
      ResponseCode: '0',
      ResponseDescription: 'The service request is processed successfully.',
      MerchantRequestID: '29115-34620561-1',
      CheckoutRequestID: checkoutRequestId,
      ResultCode: '0',
      ResultDesc: 'The service request is processed successfully.',
    });
  }

  async function adminOrder(orderId: string) {
    const { order } = await adminClient.query(OrderPayments, { id: orderId });
    return order as {
      state: string;
      payments: {
        amount: number;
        state: string;
        transactionId: string;
        metadata: Record<string, unknown>;
      }[];
    };
  }

  function mockStk(checkoutRequestId: string, responseCode = '0') {
    return nock(SANDBOX_BASE_URL)
      .post('/mpesa/stkpush/v1/processrequest')
      .reply(200, {
        MerchantRequestID: '29115-34620561-1',
        CheckoutRequestID: checkoutRequestId,
        ResponseCode: responseCode,
        ResponseDescription:
          responseCode === '0'
            ? 'Success. Request accepted for processing'
            : 'Unable to lock subscriber',
        CustomerMessage: 'ok',
      });
  }

  it('returns failure when there is no active order', async () => {
    await shopClient.asUserWithCredentials(customer.emailAddress, 'test');
    const result = await shopClient.query(Initiate, {
      phoneNumber: '+254700000000',
    });
    expect(result.initiateMpesaTransaction.success).toBe(false);
    expect(result.initiateMpesaTransaction.message).toBe(
      'No active order found for session'
    );
  });

  it('initiates an STK push for the active order', async () => {
    await arrangeArrangingPayment(shopClient);
    mockStk('ws_CO_test_1');
    const result = await shopClient.query(Initiate, {
      phoneNumber: '+254700000000',
    });
    expect(result.initiateMpesaTransaction).toMatchObject({
      success: true,
      transactionId: 'ws_CO_test_1',
    });
    await cancelActiveOrder(shopClient);
  });

  it('returns failure when the currency is not KES', async () => {
    const activeChannel = await getActiveChannel(shopClient);
    await updateChannel(adminClient, {
      id: activeChannel.id,
      defaultCurrencyCode: CurrencyCode.USD,
    });
    await arrangeArrangingPayment(shopClient);
    const result = await shopClient.query(Initiate, {
      phoneNumber: '+254700000000',
    });
    expect(result.initiateMpesaTransaction.success).toBe(false);
    expect(result.initiateMpesaTransaction.message).toBe(
      'Mpesa only supports KES currency'
    );
    await cancelActiveOrder(shopClient);
    await updateChannel(adminClient, {
      id: activeChannel.id,
      defaultCurrencyCode: CurrencyCode.KES,
    });
  });

  it('returns failure when Safaricom rejects the push', async () => {
    await arrangeArrangingPayment(shopClient);
    const scope = mockStk('ws_CO_rejected', '1');
    const result = await shopClient.query(Initiate, {
      phoneNumber: '+254700000000',
    });
    expect(result.initiateMpesaTransaction.success).toBe(false);
    expect(scope.isDone()).toBe(true);
    await cancelActiveOrder(shopClient);
  });

  it('returns failure when Safaricom cannot be reached', async () => {
    await arrangeArrangingPayment(shopClient);
    nock(SANDBOX_BASE_URL)
      .post('/mpesa/stkpush/v1/processrequest')
      .replyWithError('Connection timeout');
    const result = await shopClient.query(Initiate, {
      phoneNumber: '+254700000000',
    });
    expect(result.initiateMpesaTransaction.success).toBe(false);
    await cancelActiveOrder(shopClient);
  });

  it('verify returns PENDING while the checkout request is stored', async () => {
    const order = await arrangeArrangingPayment(shopClient);
    await setCheckoutRequestId(order.id, 'ws_CO_pending');
    const result = await shopClient.query(Verify, {
      transactionId: 'ws_CO_pending',
    });
    expect(result.verifyMpesaTransaction.status).toBe('PENDING');
    await cancelActiveOrder(shopClient);
  });

  it('verify returns FAILED when the checkout request is gone', async () => {
    await arrangeArrangingPayment(shopClient);
    const result = await shopClient.query(Verify, {
      transactionId: 'ws_CO_missing',
    });
    expect(result.verifyMpesaTransaction.status).toBe('FAILED');
    expect(result.verifyMpesaTransaction.message).toBe('Payment has failed');
    await cancelActiveOrder(shopClient);
  });

  it('verify returns SUCCESS when a payment exists', async () => {
    const order = await arrangeArrangingPayment(shopClient);
    await adminClient.query(
      gqlTag`
        mutation AddManualPayment($input: ManualPaymentInput!) {
          addManualPaymentToOrder(input: $input) {
            ... on Order {
              id
            }
            ... on ErrorResult {
              errorCode
              message
            }
          }
        }
      `,
      {
        input: {
          orderId: order.id,
          method: 'mpesa',
          transactionId: 'ws_CO_paid',
          metadata: {
            CheckoutRequestID: 'ws_CO_paid',
            MpesaReceiptNumber: 'ws_CO_paid',
          },
        },
      }
    );
    const result = await shopClient.query(Verify, {
      transactionId: 'ws_CO_paid',
    });
    expect(result.verifyMpesaTransaction.status).toBe('SUCCESS');
  });

  it('records the outstanding balance when the callback has no stored charge', async () => {
    const order = await arrangeArrangingPayment(shopClient);
    await setCheckoutRequestId(order.id, 'ws_CO_legacy');
    nock(SANDBOX_BASE_URL).post('/mpesa/stkpushquery/v1/query').reply(200, {
      ResponseCode: '0',
      ResponseDescription: 'The service request is processed successfully.',
      MerchantRequestID: '29115-34620561-1',
      CheckoutRequestID: 'ws_CO_legacy',
      ResultCode: '0',
      ResultDesc: 'The service request is processed successfully.',
    });
    const response = await postCallback(
      successCallback('ws_CO_legacy', 1, 'RCP1')
    );
    expect(response.status).not.toBe(500);
    const { order: settled } = await adminClient.query(OrderPayments, {
      id: order.id,
    });
    expect(settled.payments).toHaveLength(1);
    expect(settled.payments[0].amount).toBe(order.totalWithTax);
    expect(settled.payments[0].transactionId).toBe('ws_CO_legacy');
    expect(settled.state).toBe('PaymentSettled');
  });

  it('clears the checkout request when the STK push fails', async () => {
    const order = await arrangeArrangingPayment(shopClient);
    await setCheckoutRequestId(order.id, 'ws_CO_fail_early');
    const response = await postCallback({
      Body: {
        stkCallback: {
          MerchantRequestID: '29115-34620561-1',
          CheckoutRequestID: 'ws_CO_fail_early',
          ResultCode: 1,
          ResultDesc: 'Cancelled',
        },
      },
    });
    expect(response.status).not.toBe(500);
    const result = await shopClient.query(Verify, {
      transactionId: 'ws_CO_fail_early',
    });
    expect(result.verifyMpesaTransaction.status).toBe('FAILED');
    await cancelActiveOrder(shopClient);
  });

  it('rounds a phone-only charge up to the next shilling and stores it', async () => {
    const order = await arrangeArrangingPayment(shopClient);
    const chargeAmount = Math.ceil(order.totalWithTax / 100) * 100;
    const sent = captureStk('ws_CO_round');
    const result = await shopClient.query(Initiate, {
      phoneNumber: '+254700000000',
    });
    expect(result.initiateMpesaTransaction.success).toBe(true);
    expect(sent()?.Amount).toBe(chargeAmount / 100);
    const stored = await readMpesaFields(order.id);
    expect(stored.mpesaChargeAmount).toBe(chargeAmount);
    expect(stored.mpesaSettlementAmount).toBeNull();
    expect(stored.mpesaCheckoutRequestID).toBe('ws_CO_round');
    await cancelActiveOrder(shopClient);
  });

  it('rejects a chargeAmount that is not a whole number of shillings', async () => {
    await arrangeArrangingPayment(shopClient);
    const sent = captureStk('ws_CO_bad');
    const result = await shopClient.query(Initiate, {
      phoneNumber: '+254700000000',
      chargeAmount: 150,
    });
    expect(result.initiateMpesaTransaction).toMatchObject({
      success: false,
      message: 'chargeAmount must be a whole number of shillings.',
    });
    expect(sent()).toBeUndefined();
    await cancelActiveOrder(shopClient);
  });

  it('rejects a settlementAmount above the outstanding balance', async () => {
    await arrangeArrangingPayment(shopClient);
    const result = await shopClient.query(Initiate, {
      phoneNumber: '+254700000000',
      settlementAmount: 2_000_000_000,
    });
    expect(result.initiateMpesaTransaction.message).toBe(
      'settlementAmount cannot exceed the outstanding balance.'
    );
    await cancelActiveOrder(shopClient);
  });

  it('rejects a settlementAmount of zero', async () => {
    await arrangeArrangingPayment(shopClient);
    const result = await shopClient.query(Initiate, {
      phoneNumber: '+254700000000',
      settlementAmount: 0,
    });
    expect(result.initiateMpesaTransaction).toMatchObject({
      success: false,
      message: 'settlementAmount must be a positive integer.',
    });
    await cancelActiveOrder(shopClient);
  });

  it('rejects a chargeAmount below the settlement amount', async () => {
    await arrangeArrangingPayment(shopClient);
    const result = await shopClient.query(Initiate, {
      phoneNumber: '+254700000000',
      settlementAmount: 200,
      chargeAmount: 100,
    });
    expect(result.initiateMpesaTransaction).toMatchObject({
      success: false,
      message: 'chargeAmount cannot be less than the settlement amount.',
    });
    await cancelActiveOrder(shopClient);
  });

  it('records the outstanding balance when the collected charge is higher', async () => {
    const order = await arrangeArrangingPayment(shopClient);
    const chargeAmount = roundUpToShilling(order.totalWithTax) + 100;
    captureStk('ws_CO_fee');
    await shopClient.query(Initiate, {
      phoneNumber: '+254700000000',
      chargeAmount,
    });
    mockStkQuery('ws_CO_fee');
    const response = await postCallback(
      successCallback('ws_CO_fee', chargeAmount / 100, 'RCPFEE')
    );
    expect(response.status).toBeLessThan(500);
    const settled = await adminOrder(order.id);
    expect(settled.state).toBe('PaymentSettled');
    expect(settled.payments).toHaveLength(1);
    expect(settled.payments[0].amount).toBe(order.totalWithTax);
    expect(settled.payments[0].transactionId).toBe('ws_CO_fee');
    expect(settled.payments[0].metadata.chargeAmount).toBe(chargeAmount);
    expect(settled.payments[0].metadata.mpesaReceiptNumber).toBe('RCPFEE');
  });

  it('records an explicit settlementAmount below the balance', async () => {
    const order = await arrangeArrangingPayment(shopClient);
    const settlementAmount = Math.min(100, order.totalWithTax - 1);
    const chargeAmount = Math.ceil(settlementAmount / 100) * 100;
    const sent = captureStk('ws_CO_deposit');
    const initiated = await shopClient.query(Initiate, {
      phoneNumber: '+254700000000',
      settlementAmount,
    });
    expect(initiated.initiateMpesaTransaction.success).toBe(true);
    expect(sent()?.Amount).toBe(chargeAmount / 100);
    mockStkQuery('ws_CO_deposit');
    await postCallback(
      successCallback('ws_CO_deposit', chargeAmount / 100, 'RCPDEP')
    );
    const settled = await adminOrder(order.id);
    expect(settled.payments).toHaveLength(1);
    expect(settled.payments[0].amount).toBe(settlementAmount);
    expect(settled.state).not.toBe('PaymentSettled');
    await cancelActiveOrder(shopClient);
  });

  it('creates one payment when the callback is delivered twice', async () => {
    const order = await arrangeArrangingPayment(shopClient);
    const chargeAmount = Math.ceil(order.totalWithTax / 100) * 100;
    captureStk('ws_CO_once');
    await shopClient.query(Initiate, { phoneNumber: '+254700000000' });
    mockStkQuery('ws_CO_once');
    await postCallback(
      successCallback('ws_CO_once', chargeAmount / 100, 'RCPONCE')
    );
    mockStkQuery('ws_CO_once');
    const second = await postCallback(
      successCallback('ws_CO_once', chargeAmount / 100, 'RCPONCE')
    );
    expect(second.status).toBe(200);
    const settled = await adminOrder(order.id);
    expect(settled.payments).toHaveLength(1);
    expect(settled.payments[0].transactionId).toBe('ws_CO_once');
  });

  it('answers 200 when the callback amount does not match the stored charge', async () => {
    const order = await arrangeArrangingPayment(shopClient);
    const chargeAmount = Math.ceil(order.totalWithTax / 100) * 100;
    captureStk('ws_CO_mismatch');
    await shopClient.query(Initiate, { phoneNumber: '+254700000000' });
    const response = await postCallback(
      successCallback('ws_CO_mismatch', chargeAmount / 100 + 1, 'RCPBAD')
    );
    expect(response.status).toBe(200);
    const settled = await adminOrder(order.id);
    expect(settled.payments ?? []).toHaveLength(0);
    await cancelActiveOrder(shopClient);
  });

  it('answers 200 when the outstanding balance grows past the charge', async () => {
    const order = await arrangeAddingItems(shopClient);
    const chargeAmount = Math.ceil(order.totalWithTax / 100) * 100;
    captureStk('ws_CO_grew');
    await shopClient.query(Initiate, {
      phoneNumber: '+254700000000',
      chargeAmount,
    });
    await addItem(shopClient, 1, 1);
    await shopClient.query(gqlTag`
      mutation {
        transitionOrderToState(state: "ArrangingPayment") {
          ... on Order { state }
        }
      }
    `);
    const response = await postCallback(
      successCallback('ws_CO_grew', chargeAmount / 100, 'RCPGREW')
    );
    expect(response.status).toBe(200);
    const settled = await adminOrder(order.id);
    expect(settled.payments ?? []).toHaveLength(0);
    await cancelActiveOrder(shopClient);
  });

  it('answers 403 when the callback IP is not allowlisted', async () => {
    const response = await postCallback(
      successCallback('ws_CO_forbidden', 1, 'RCPFORB'),
      { 'x-forwarded-for': '203.0.113.5' }
    );
    expect(response.status).toBe(403);
  });

  it('answers 500 when a successful callback matches no order', async () => {
    const response = await postCallback(
      successCallback('ws_CO_missing', 1, 'RCPMISS')
    );
    expect(response.status).toBe(500);
  });

  it('answers 200 when a failed callback matches no order', async () => {
    const response = await postCallback({
      Body: {
        stkCallback: {
          MerchantRequestID: '29115-34620561-1',
          CheckoutRequestID: 'ws_CO_unknown_fail',
          ResultCode: 1,
          ResultDesc: 'Cancelled',
        },
      },
    });
    expect(response.status).toBe(200);
  });

  it('clears the stored amounts when the STK push fails', async () => {
    const order = await arrangeArrangingPayment(shopClient);
    captureStk('ws_CO_fail');
    await shopClient.query(Initiate, { phoneNumber: '+254700000000' });
    const response = await postCallback({
      Body: {
        stkCallback: {
          MerchantRequestID: '29115-34620561-1',
          CheckoutRequestID: 'ws_CO_fail',
          ResultCode: 1032,
          ResultDesc: 'Cancelled by user',
        },
      },
    });
    expect(response.status).toBe(200);
    const stored = await readMpesaFields(order.id);
    expect(stored.mpesaCheckoutRequestID).toBeNull();
    expect(stored.mpesaChargeAmount).toBeNull();
    expect(stored.mpesaSettlementAmount).toBeNull();
    await cancelActiveOrder(shopClient);
  });

  it('reverses the collected shillings', async () => {
    const order = await arrangeArrangingPayment(shopClient);
    const chargeAmount = Math.ceil(order.totalWithTax / 100) * 100;
    captureStk('ws_CO_refund');
    await shopClient.query(Initiate, { phoneNumber: '+254700000000' });
    mockStkQuery('ws_CO_refund');
    await postCallback(
      successCallback('ws_CO_refund', chargeAmount / 100, 'RCPREV')
    );

    let reversal: { TransactionID?: string; Amount?: number } = {};
    nock(SANDBOX_BASE_URL)
      .post('/mpesa/reversal/v1/request', (body) => {
        reversal = body as { TransactionID?: string; Amount?: number };
        return true;
      })
      .reply(200, {
        OriginatorConversationID: '29115-34620561-1',
        ConversationID: 'AG_20210727_00005797af5d7d75f652',
        ResponseCode: '0',
        ResponseDescription: 'Accept the service request successfully.',
      });

    const paid = await adminClient.query(
      gqlTag`
        query PaidOrder($id: ID!) {
          order(id: $id) {
            payments {
              id
            }
          }
        }
      `,
      { id: order.id }
    );
    const refunded = await adminClient.query(
      gqlTag`
        mutation RefundOrder($input: RefundOrderInput!) {
          refundOrder(input: $input) {
            ... on Refund {
              __typename
              state
              transactionId
            }
            ... on ErrorResult {
              errorCode
              message
            }
          }
        }
      `,
      {
        input: {
          paymentId: paid.order.payments[0].id,
          amount: order.totalWithTax,
          shipping: 0,
          adjustment: 0,
        },
      }
    );
    expect(refunded.refundOrder).toMatchObject({
      __typename: 'Refund',
      state: 'Validating',
      transactionId: 'RCPREV',
    });
    expect(reversal.TransactionID).toBe('RCPREV');
    expect(reversal.Amount).toBe(chargeAmount / 100);

    const callback = await shopClient.fetch(
      `http://localhost:${API_PORT}/daraja/reversal/callback`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          Result: {
            ResultType: 0,
            ResultCode: '0',
            ResultDesc: 'The service request is processed successfully.',
            OriginatorConversationID: '29115-34620561-1',
            ConversationID: 'AG_20210727_00005797af5d7d75f652',
            TransactionID: 'RCPREV',
            ResultParameters: { ResultParameter: [] },
            ReferenceData: { ReferenceItem: { Key: '', Value: '' } },
          },
        }),
      }
    );
    expect(callback.status).toBeLessThan(500);
    const after = await adminClient.query(
      gqlTag`
        query RefundedOrder($id: ID!) {
          order(id: $id) {
            payments {
              refunds {
                state
              }
            }
          }
        }
      `,
      { id: order.id }
    );
    expect(after.order.payments[0].refunds[0].state).toBe('Settled');
  });
});
