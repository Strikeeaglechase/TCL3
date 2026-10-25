interface SourceSpan {
	startIndex: number;
	endIndex: number;
	fileIdentifier: string;
}

abstract class TCl3Error extends Error {
	constructor(
		message: string,
		public location: SourceSpan
	) {
		super(message);
	}
}

class TokenizerError extends TCl3Error {
	constructor(message: string, location: SourceSpan) {
		super(message, location);
	}
}

class ParserError extends TCl3Error {
	constructor(message: string, location: SourceSpan) {
		super(message, location);
	}
}

export { TCl3Error, TokenizerError, ParserError, SourceSpan };
