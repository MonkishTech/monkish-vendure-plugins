import { graphql } from '../../graphql/admin';

export const GetCustomerList = graphql(`
  query GetCustomerList($options: CustomerListOptions) {
    customers(options: $options) {
      items {
        id
        title
        firstName
        lastName
        emailAddress
        phoneNumber
        user {
          id
          verified
        }
      }
      totalItems
    }
  }
`);

export const UpdateChannel = graphql(`
  mutation UpdateChannel($input: UpdateChannelInput!) {
    updateChannel(input: $input) {
      __typename
      ... on Channel {
        id
        code
        token
      }
    }
  }
`);
