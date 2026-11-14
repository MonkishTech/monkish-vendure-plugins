import { LanguageCode } from '@vendure/core';
import { addLipaMdogoCustomFields } from './custom-fields';

describe('addLipaMdogoCustomFields', () => {
  it('uses currency-form-input for lipaMdogoMinimum', () => {
    const config = {
      customFields: {
        ProductVariant: [] as Array<Record<string, unknown>>,
      },
    };

    addLipaMdogoCustomFields(config as Parameters<typeof addLipaMdogoCustomFields>[0]);

    const field = config.customFields.ProductVariant.find(
      (entry) => entry.name === 'lipaMdogoMinimum'
    );

    expect(field).toMatchObject({
      name: 'lipaMdogoMinimum',
      type: 'int',
      defaultValue: 0,
      public: true,
      label: [{ languageCode: LanguageCode.en, value: 'Lipa mdogo deposit' }],
      ui: { component: 'currency-form-input' },
    });
  });
});
