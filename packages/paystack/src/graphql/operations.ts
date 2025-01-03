import { graphql } from '../types';

export const CreatePaystackPaymentIntent = graphql(`
  mutation CreatePaystackPaymentIntent($input: PaystackPaymentIntentInput!) {
    createPaystackPaymentIntent(input: $input) {
      ... on PaystackPaymentIntent {
        status
        message
        data {
          authorization_url
          access_code
          reference
        }
      }
      ... on PaystackPaymentIntentError {
        errorCode
        message
      }
    }
  }
`);
