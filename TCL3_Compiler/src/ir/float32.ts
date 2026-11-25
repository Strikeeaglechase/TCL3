const floatBuffer = new ArrayBuffer(4);
const floatView = new DataView(floatBuffer);

function float32ToBits(value: number): number {
	floatView.setFloat32(0, value, true);
	return floatView.getInt32(0, true);
}

function bitsToFloat32(bits: number): number {
	floatView.setInt32(0, bits, true);
	return floatView.getFloat32(0, true);
}

export { float32ToBits, bitsToFloat32 };
