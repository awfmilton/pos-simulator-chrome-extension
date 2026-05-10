const { bufferSourceToByteArray } = require('../interceptor.js');

describe('bufferSourceToByteArray', () => {
    it('should handle ArrayBuffer', () => {
        const buffer = new ArrayBuffer(4);
        const view = new Uint8Array(buffer);
        view[0] = 1; view[1] = 2; view[2] = 3; view[3] = 4;

        const result = bufferSourceToByteArray(buffer);
        expect(result).toEqual([1, 2, 3, 4]);
        expect(Array.isArray(result)).toBe(true);
    });

    it('should handle TypedArrays (ArrayBuffer.isView)', () => {
        const buffer = new ArrayBuffer(8);
        const uint8View = new Uint8Array(buffer);
        uint8View.set([1, 2, 3, 4], 2);

        const subView = new Uint8Array(buffer, 2, 4);
        const result = bufferSourceToByteArray(subView);
        expect(result).toEqual([1, 2, 3, 4]);
        expect(Array.isArray(result)).toBe(true);
    });

    it('should handle arrays or array-like objects', () => {
        const arr = [5, 6, 7, 8];
        const result = bufferSourceToByteArray(arr);
        expect(result).toEqual([5, 6, 7, 8]);
        expect(Array.isArray(result)).toBe(true);

        const arrayLike = { 0: 9, 1: 10, length: 2 };
        expect(bufferSourceToByteArray(arrayLike)).toEqual([9, 10]);
    });

    it('should throw an error for invalid inputs', () => {
        expect(() => { bufferSourceToByteArray(null); }).toThrow('Invalid BufferSource');
        expect(() => { bufferSourceToByteArray(undefined); }).toThrow('Invalid BufferSource');
        expect(() => { bufferSourceToByteArray(123); }).toThrow('Invalid BufferSource');
        expect(() => { bufferSourceToByteArray("string"); }).toThrow('Invalid BufferSource');
        expect(() => { bufferSourceToByteArray({}); }).toThrow('Invalid BufferSource');
    });
});
