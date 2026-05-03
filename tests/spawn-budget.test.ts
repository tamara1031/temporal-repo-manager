import { describe, it, expect } from 'vitest';
import { SpawnCounter } from '../src/workflows/_internal/spawn-budget';

describe('SpawnCounter', () => {
  it('starts at zero with full remaining budget', () => {
    const c = new SpawnCounter(10);
    expect(c.remaining()).toBe(10);
    expect(c.summary()).toEqual({ total: 0, cap: 10, perRole: {} });
  });

  it('canConsume is true up to the cap boundary', () => {
    const c = new SpawnCounter(5);
    expect(c.canConsume(5)).toBe(true);
    expect(c.canConsume(6)).toBe(false);
  });

  it('consume tracks by role and reduces remaining', () => {
    const c = new SpawnCounter(10);
    c.consume('planner', 1);
    c.consume('implementer', 2);
    expect(c.remaining()).toBe(7);
    expect(c.summary().perRole).toEqual({ planner: 1, implementer: 2 });
    expect(c.summary().total).toBe(3);
  });

  it('consume accumulates counts within the same role', () => {
    const c = new SpawnCounter(10);
    c.consume('reviewer', 2);
    c.consume('reviewer', 3);
    expect(c.summary().perRole['reviewer']).toBe(5);
  });

  it('canConsume returns false after budget is exhausted', () => {
    const c = new SpawnCounter(3);
    c.consume('planner', 3);
    expect(c.canConsume(1)).toBe(false);
    expect(c.remaining()).toBe(0);
  });

  it('remaining never goes below zero even after over-consumption via merge', () => {
    const c = new SpawnCounter(2);
    c.merge({ implementer: 5 });
    expect(c.remaining()).toBe(0);
  });

  it('merge reconciles child counts without checking the cap', () => {
    const parent = new SpawnCounter(10);
    parent.consume('context', 1);
    parent.merge({ planner: 2, 'plan-reviewer': 1 });
    expect(parent.remaining()).toBe(6);
    expect(parent.summary().perRole).toEqual({ context: 1, planner: 2, 'plan-reviewer': 1 });
  });

  it('merge accumulates into existing role counts', () => {
    const parent = new SpawnCounter(10);
    parent.consume('implementer', 2);
    parent.merge({ implementer: 1, reviewer: 3 });
    expect(parent.summary().perRole['implementer']).toBe(3);
    expect(parent.summary().perRole['reviewer']).toBe(3);
    expect(parent.summary().total).toBe(6);
  });

  it('merge silently skips entries with n <= 0', () => {
    const parent = new SpawnCounter(10);
    parent.merge({ planner: 0, implementer: -1, reviewer: 2 });
    expect(parent.summary().perRole).toEqual({ reviewer: 2 });
    expect(parent.summary().total).toBe(2);
  });

  it('summary returns a snapshot copy, not a live reference', () => {
    const c = new SpawnCounter(10);
    c.consume('planner', 1);
    const snap = c.summary();
    c.consume('planner', 1);
    expect(snap.total).toBe(1);
    expect(snap.perRole['planner']).toBe(1);
  });
});
