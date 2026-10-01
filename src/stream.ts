function isPredicate<T>(value: unknown): value is (value: T) => boolean {
	return typeof value === "function";
}

class Stream<T> {
	private index: number = 0;
	constructor(private data: T[]) {}

	public peak(): T {
		return this.data[this.index];
	}

	public next(): T {
		return this.data[this.index++];
	}

	public eof(): boolean {
		return this.index >= this.data.length;
	}

	public readUntil(predicate: T | ((value: T) => boolean)): T[] {
		const result: T[] = [];
		if (isPredicate<T>(predicate)) {
			while (!this.eof() && !predicate(this.peak())) {
				result.push(this.next());
			}
		} else {
			while (!this.eof() && this.peak() !== predicate) {
				result.push(this.next());
			}
		}

		return result;
	}

	public readUntilAndSkip(predicate: T | ((value: T) => boolean)): T[] {
		const result = this.readUntil(predicate);
		this.next(); // Skip the item that satisfied the predicate
		return result;
	}

	public readUntilAndConsume(value: T): T[];
	public readUntilAndConsume(predicate: (value: T) => boolean, expected: T): T[];
	public readUntilAndConsume(predicate: T | ((value: T) => boolean), expected?: T): T[] {
		const result = this.readUntil(predicate);
		if (expected) this.consume(expected);
		else this.consume(predicate as T);
		return result;
	}

	public consume(expected: T): T {
		const value = this.next();
		if (value !== expected) {
			throw new Error(`Expected ${expected} but got ${this.peak()}`);
		}

		return value;
	}
}

class TypedObjectStream<T extends { type: unknown; value: unknown }> extends Stream<T> {
	public consumeType(expectedType: T["type"]): T {
		const value = this.next();
		if (value.type !== expectedType) {
			throw new Error(`Expected type ${expectedType} but got ${value.type}`);
		}

		return value;
	}

	public consumeTV(expectedType: T["type"], expectedValue: T["value"]): T {
		const value = this.next();
		if (value.type !== expectedType || value.value !== expectedValue) {
			throw new Error(`Expected '${expectedType}' with value of '${expectedValue}' but got '${value.type}' with value of '${value.value}'`);
		}

		return value;
	}
}

export { Stream, TypedObjectStream };
