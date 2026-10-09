import gql from 'graphql-tag';

export const shopApiExtensions = gql`
  enum MpesaPaymentStatus {
    SUCCESS
    FAILED
    PENDING
  }

  type MpesaTransactionVerification {
    status: MpesaPaymentStatus!
    transactionId: String!
    message: String!
  }

  type MpesaTransactionInitiation {
    success: Boolean!
    transactionId: String
    message: String!
  }

  extend type Mutation {
    initiateMpesaTransaction(
      phoneNumber: String!
      "What M-Pesa collects, in minor units. Defaults to the settlement amount rounded up to the next shilling."
      chargeAmount: Money
      "What is written to Payment.amount. Defaults to the outstanding balance. Cannot exceed it."
      settlementAmount: Money
    ): MpesaTransactionInitiation!

    verifyMpesaTransaction(
      transactionId: String!
    ): MpesaTransactionVerification!
  }
`;
