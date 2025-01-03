import { initGraphQLTada } from 'gql.tada';
import type { introspection } from './vendure';

export const graphql = initGraphQLTada<{
  introspection: typeof introspection;
  scalars: {
    ID: string | number;
    String: string;
    DateTime: string;
    Money: number;
    JSON: Record<string, string>;
  };
}>();
