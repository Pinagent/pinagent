// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { ClientMessageSchema } from '../src/ws-protocol';

const validId = 'AbCdEfGh12'; // 10 chars, allowed alphabet

describe('ClientMessageSchema', () => {
  describe('subscribe', () => {
    it('accepts a well-formed subscribe', () => {
      expect(
        ClientMessageSchema.safeParse({ type: 'subscribe', feedbackId: validId }).success,
      ).toBe(true);
    });

    it('rejects a feedbackId with special chars', () => {
      expect(
        ClientMessageSchema.safeParse({ type: 'subscribe', feedbackId: 'has!chars' }).success,
      ).toBe(false);
    });

    it('rejects a too-short feedbackId', () => {
      expect(
        ClientMessageSchema.safeParse({ type: 'subscribe', feedbackId: 'short' }).success,
      ).toBe(false);
    });

    it('rejects a too-long feedbackId', () => {
      expect(
        ClientMessageSchema.safeParse({
          type: 'subscribe',
          feedbackId: 'a'.repeat(17),
        }).success,
      ).toBe(false);
    });

    it('rejects when feedbackId is missing', () => {
      expect(ClientMessageSchema.safeParse({ type: 'subscribe' }).success).toBe(false);
    });
  });

  describe('unsubscribe', () => {
    it('accepts a well-formed unsubscribe', () => {
      expect(
        ClientMessageSchema.safeParse({ type: 'unsubscribe', feedbackId: validId }).success,
      ).toBe(true);
    });
  });

  describe('user_message', () => {
    it('accepts a well-formed user_message', () => {
      expect(
        ClientMessageSchema.safeParse({
          type: 'user_message',
          feedbackId: validId,
          content: 'follow up plz',
        }).success,
      ).toBe(true);
    });

    it('rejects empty content', () => {
      expect(
        ClientMessageSchema.safeParse({
          type: 'user_message',
          feedbackId: validId,
          content: '',
        }).success,
      ).toBe(false);
    });

    it('rejects oversize content (>8000 chars)', () => {
      expect(
        ClientMessageSchema.safeParse({
          type: 'user_message',
          feedbackId: validId,
          content: 'x'.repeat(8001),
        }).success,
      ).toBe(false);
    });
  });

  describe('ask_response', () => {
    it('accepts a well-formed ask_response', () => {
      expect(
        ClientMessageSchema.safeParse({
          type: 'ask_response',
          askId: 'a1b2c3',
          answer: 'yes',
        }).success,
      ).toBe(true);
    });

    it('accepts an empty answer (user may submit blank)', () => {
      expect(
        ClientMessageSchema.safeParse({
          type: 'ask_response',
          askId: 'a1b2c3',
          answer: '',
        }).success,
      ).toBe(true);
    });

    it('rejects oversize answer (>8000 chars)', () => {
      expect(
        ClientMessageSchema.safeParse({
          type: 'ask_response',
          askId: 'a',
          answer: 'x'.repeat(8001),
        }).success,
      ).toBe(false);
    });

    it('rejects empty askId', () => {
      expect(
        ClientMessageSchema.safeParse({
          type: 'ask_response',
          askId: '',
          answer: 'hi',
        }).success,
      ).toBe(false);
    });
  });

  describe('interrupt', () => {
    it('accepts a well-formed interrupt', () => {
      expect(
        ClientMessageSchema.safeParse({ type: 'interrupt', feedbackId: validId }).success,
      ).toBe(true);
    });
  });

  describe('ping', () => {
    it('accepts a bare ping with no fields', () => {
      expect(ClientMessageSchema.safeParse({ type: 'ping' }).success).toBe(true);
    });
  });

  it('rejects an unknown type', () => {
    expect(ClientMessageSchema.safeParse({ type: 'definitely-not-a-message' }).success).toBe(false);
  });

  it('rejects null / non-object input', () => {
    expect(ClientMessageSchema.safeParse(null).success).toBe(false);
    expect(ClientMessageSchema.safeParse('string').success).toBe(false);
    expect(ClientMessageSchema.safeParse(42).success).toBe(false);
  });
});
