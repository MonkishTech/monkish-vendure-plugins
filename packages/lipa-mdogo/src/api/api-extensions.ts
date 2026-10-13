import gql from 'graphql-tag';

export const shopApiExtensions = gql`
  input StartLipaMdogoPlanInput {
    "Minimum payment, in minor units."
    minimumPayment: Money!
    deadline: DateTime!
    "Days before the deadline. Defaults to [7, 1, 0]."
    reminderDaysBefore: [Int!]
  }

  enum LipaMdogoPlanState {
    Active
    Completed
    Missed
  }

  type LipaMdogoPlan {
    minimumPayment: Money!
    deadline: DateTime!
    outstanding: Money!
    minimumDue: Money!
    state: LipaMdogoPlanState!
  }

  extend type Mutation {
    startLipaMdogoPlan(input: StartLipaMdogoPlanInput!): LipaMdogoPlan!
  }

  extend type Order {
    lipaMdogoPlan: LipaMdogoPlan
  }
`;
