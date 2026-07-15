import { LifecycleScope } from '../../apps/desktop/electron/lifecycle';
import { describe, expect, it } from 'vitest';

describe('lifecycle scope', () => {
  it('disposes resources once in reverse registration order', async () => {
    const order: number[] = [];
    const lifecycle = new LifecycleScope();
    lifecycle.add(() => {
      order.push(1);
    });
    lifecycle.add(async () => {
      order.push(2);
    });
    await lifecycle.dispose();
    await lifecycle.dispose();
    expect(order).toEqual([2, 1]);
    expect(() => lifecycle.add(() => undefined)).toThrow('disposed lifecycle');
  });
});
