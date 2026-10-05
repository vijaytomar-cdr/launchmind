import { describe, it, expect } from 'vitest';
import { directionCannotProve } from '../src/services/content/directionAdjustment';
describe('direction is not proof', () => {
  const cases: Array<[string, boolean]> = [
    ['our conversion rate is 80% higher', true],
    ['we have 12,000 customers', true],
    ['we are 3x faster', true],
    ['we are the only tool that does this', true],
    ['better than Notion for teams', true],
    ['we are SOC 2 compliant', true],
    ['results guaranteed', true],
    ['focus more on trust than convenience', false],
    ['speak to product managers, not founders', false],
    ['make it warmer and less clever', false],
  ];
  for (const [text, expected] of cases) {
    it(`${expected ? 'discloses' : 'stays quiet on'}: ${text}`, () => {
      expect(directionCannotProve({ note: text }).length > 0).toBe(expected);
    });
  }
  it('never claims the owner text is true', () => {
    const out = directionCannotProve({ note: 'conversion is 80% higher' }).join(' ');
    expect(out).toMatch(/not as something it can prove/);
    expect(out).toMatch(/will need evidence/);
  });
});
