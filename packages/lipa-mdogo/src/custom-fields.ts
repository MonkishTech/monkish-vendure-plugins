import { LanguageCode, RuntimeVendureConfig } from '@vendure/core';

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
      label: [{ languageCode: LanguageCode.en, value: 'Lipa mdogo enabled' }],
    },
    {
      name: 'lipaMdogoMinimum',
      type: 'int',
      defaultValue: 0,
      public: true,
      label: [{ languageCode: LanguageCode.en, value: 'Lipa mdogo deposit' }],
    },
    {
      name: 'lipaMdogoDeadline',
      type: 'datetime',
      nullable: true,
      public: true,
      label: [{ languageCode: LanguageCode.en, value: 'Lipa mdogo deadline' }],
    }
  );
}
