function isPredicate<T>(value: unknown): value is (value: T) => boolean {
	return typeof value === "function";
}

class Stream<T> {
	private index: number = 0;
	public get position() {
		return Math.min(this.index, this.data.length);
	}
	constructor(public data: T[]) {}

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

class CharStream {
	private index: number = 0;
	private data: { char: string; index: number }[] = [];
	public position: number = 0;

	constructor(data: string[]) {
		this.data = data.map((char, idx) => ({ char, index: idx }));
	}

	public peak() {
		return this.data[this.index].char;
	}

	public next() {
		const value = this.data[this.index++];
		this.position = value.index;
		return value.char;
	}

	public eof(): boolean {
		return this.index >= this.data.length;
	}

	public readUntil(predicate: string | ((value: string) => boolean)): string[] {
		const result: string[] = [];
		if (isPredicate(predicate)) {
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

	public readUntilAndSkip(predicate: string | ((value: string) => boolean)): string[] {
		const result = this.readUntil(predicate);
		this.next(); // Skip the item that satisfied the predicate
		return result;
	}

	public readUntilAndConsume(value: string): string[];
	public readUntilAndConsume(predicate: (value: string) => boolean, expected: string): string[];
	public readUntilAndConsume(predicate: string | ((value: string) => boolean), expected?: string): string[] {
		const result = this.readUntil(predicate);
		if (expected) this.consume(expected);
		else this.consume(predicate as string);
		return result;
	}

	public consume(expected: string): string {
		const value = this.next();
		if (value !== expected) {
			throw new Error(`Expected ${expected} but got ${this.peak()}`);
		}

		return value;
	}

	public findAndReplace(find: string, replace: string): void {
		for (let i = 0; i < this.data.length; i++) {
			let match = true;
			for (let j = 0; j < find.length; j++) {
				if (this.data[i + j].char !== find[j]) {
					match = false;
					break;
				}
			}

			if (match) {
				const insert = replace.split("").map((char, idx) => ({ char, index: this.data[i].index + idx }));
				this.data.splice(i, find.length, ...insert);
				i += replace.length - 1; // Move index to the end of the replaced string
			}
		}
	}
}

class TypedObjectStream<T extends { type: unknown; value: unknown }> extends Stream<T> {
	public consumeType(expectedType: T["type"]): T {
		const value = this.peak();
		if (value.type !== expectedType) {
			throw new Error(`Expected ${expectedType} but got ${value.type}`);
		}
		this.next();

		return value;
	}

	public consumeTV(expectedType: T["type"], expectedValue: T["value"]): T {
		const value = this.next();
		if (value.type !== expectedType || value.value !== expectedValue) {
			throw new Error(`Expected '${expectedType}' with value of '${expectedValue}' but got '${value.type}' with value of '${value.value}'`);
		}

		return value;
	}

	public maybeConsumeTV(expectedType: T["type"], expectedValue: T["value"]): boolean {
		const peaked = this.peak();
		if (peaked.type === expectedType && peaked.value === expectedValue) {
			this.next();
			return true;
		}

		return false;
	}
}

export { Stream, CharStream, TypedObjectStream };
