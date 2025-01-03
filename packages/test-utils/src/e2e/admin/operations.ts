import { adminGraphQL } from '../../generated/types';

export const GetCustomerList = adminGraphQL(`
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
