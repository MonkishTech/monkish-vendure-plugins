import gql from 'graphql-tag';
import { DocumentNode } from 'graphql';

export const shopApiSchemaExtensions: DocumentNode = gql`
  enum PaystackPaymentChannel {
    CARD
    BANK
    USSD
    QR
    MOBILE_MONEY
    BANK_TRANSFER
    EFT
  }

  input PaystackPaymentIntentInput {
    """
    Fully qualified url, e.g. https://example.com/.
    Use this to override the callback url provided on the dashboard for this transaction.
    """
    callbackUrl: String

    """
    An array of payment channels to control what channels you want to make available
    to the user to make a payment with. If not specified, the customer will be shown all
    the payment methods selected on your dashboard.
    """
    channels: [PaystackPaymentChannel!]

    """
    JSON object of custom data.
    """
    metadata: JSON
  }

  type PaystackPaymentIntentData {
    authorization_url: String!
    access_code: String!
    reference: String!
  }

  type PaystackPaymentIntent {
    status: Boolean!
    message: String!
    data: PaystackPaymentIntentData!
  }

  type PaystackPaymentIntentError implements ErrorResult {
    errorCode: ErrorCode!
    message: String!
  }

  union PaystackPaymentIntentResult =
      PaystackPaymentIntent
    | PaystackPaymentIntentError

  extend type Mutation {
    createPaystackPaymentIntent(
      input: PaystackPaymentIntentInput!
    ): PaystackPaymentIntentResult!
  }
`;
