import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DateTime } from 'luxon';
import { quantizeDateTo30MinuteInterval } from './engine.js';

describe('quantizeDateTo30MinuteInterval', () => {
    it('should quantize 9:00 to 9:00', () => {
        const dt = DateTime.fromISO('2024-01-15T09:00:00.000Z');
        const quantized = quantizeDateTo30MinuteInterval(dt);
        assert.equal(quantized.toISO(), '2024-01-15T09:00:00.000+00:00');
    });

    it('should quantize 9:29 to 9:00', () => {
        const dt = DateTime.fromISO('2024-01-15T09:29:59.999Z');
        const quantized = quantizeDateTo30MinuteInterval(dt);
        assert.equal(quantized.toISO(), '2024-01-15T09:00:00.000+00:00');
    });

    it('should quantize 9:30 to 9:30', () => {
        const dt = DateTime.fromISO('2024-01-15T09:30:00.000Z');
        const quantized = quantizeDateTo30MinuteInterval(dt);
        assert.equal(quantized.toISO(), '2024-01-15T09:30:00.000+00:00');
    });

    it('should quantize 9:59 to 9:30', () => {
        const dt = DateTime.fromISO('2024-01-15T09:59:59.999Z');
        const quantized = quantizeDateTo30MinuteInterval(dt);
        assert.equal(quantized.toISO(), '2024-01-15T09:30:00.000+00:00');
    });

    it('should quantize 10:00 to 10:00', () => {
        const dt = DateTime.fromISO('2024-01-15T10:00:00.000Z');
        const quantized = quantizeDateTo30MinuteInterval(dt);
        assert.equal(quantized.toISO(), '2024-01-15T10:00:00.000+00:00');
    });

    it('should quantize 11:56 to 11:30', () => {
        const dt = DateTime.fromISO('2024-01-15T11:56:23.456Z');
        const quantized = quantizeDateTo30MinuteInterval(dt);
        assert.equal(quantized.toISO(), '2024-01-15T11:30:00.000+00:00');
    });

    it('should quantize 12:15 to 12:00', () => {
        const dt = DateTime.fromISO('2024-01-15T12:15:00.000Z');
        const quantized = quantizeDateTo30MinuteInterval(dt);
        assert.equal(quantized.toISO(), '2024-01-15T12:00:00.000+00:00');
    });

    it('should quantize 12:45 to 12:30', () => {
        const dt = DateTime.fromISO('2024-01-15T12:45:00.000Z');
        const quantized = quantizeDateTo30MinuteInterval(dt);
        assert.equal(quantized.toISO(), '2024-01-15T12:30:00.000+00:00');
    });

    it('should quantize across different timezones', () => {
        const dt = DateTime.fromISO('2024-01-15T09:47:00.000-05:00', { zone: 'America/New_York' });
        const quantized = quantizeDateTo30MinuteInterval(dt);
        assert.equal(quantized.toISO(), '2024-01-15T09:30:00.000-05:00');
    });

    it('should preserve date when quantizing', () => {
        const dt = DateTime.fromISO('2024-12-31T23:47:00.000Z');
        const quantized = quantizeDateTo30MinuteInterval(dt);
        assert.equal(quantized.toISO(), '2024-12-31T23:30:00.000+00:00');
    });

    it('should handle edge case at minute 0', () => {
        const dt = DateTime.fromISO('2024-01-15T14:00:00.000Z');
        const quantized = quantizeDateTo30MinuteInterval(dt);
        assert.equal(quantized.toISO(), '2024-01-15T14:00:00.000+00:00');
    });

    it('should handle edge case at minute 30', () => {
        const dt = DateTime.fromISO('2024-01-15T14:30:00.000Z');
        const quantized = quantizeDateTo30MinuteInterval(dt);
        assert.equal(quantized.toISO(), '2024-01-15T14:30:00.000+00:00');
    });
});
