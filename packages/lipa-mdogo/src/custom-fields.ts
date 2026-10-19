import { RuntimeVendureConfig } from '@vendure/core';

declare module '@vendure/core' {
  interface CustomProductVariantFields {
    lipaMdogoEnabled: boolean;
    lipaMdogoMinimum: number;
    lipaMdogoDeadline: Date | null;
  }
}

export function addLipaMdogoCustomFields(config: RuntimeVendureConfig): void {
  config.customFields.ProductVariant.push(
    {
      name: 'lipaMdogoEnabled',
      type: 'boolean',
      defaultValue: false,
      public: true,
    },
    {
      name: 'lipaMdogoMinimum',
      type: 'int',
      defaultValue: 0,
      public: true,
    },
    {
      name: 'lipaMdogoDeadline',
      type: 'datetime',
      nullable: true,
      public: true,
    }
  );
}
