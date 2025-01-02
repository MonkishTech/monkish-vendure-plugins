import { graphql } from 'src/types';

export const CreatePaystackPaymentIntentMutation = graphql(`
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
