interface SourceSpan {
	startIndex: number;
	endIndex: number;
	fileIdentifier: string;
}

abstract class TCl3Error extends Error {
	public override readonly cause: Error;
	constructor(
		orgError: Error,
		public location: SourceSpan
	) {
		super(orgError.message, { cause: orgError });
	}
}

class TokenizerError extends TCl3Error {
	constructor(orgError: Error, location: SourceSpan) {
		super(orgError, location);
	}
}

class ParserError extends TCl3Error {
	constructor(orgError: Error, location: SourceSpan) {
		super(orgError, location);
	}
}

class CompilerError extends TCl3Error {
	constructor(orgError: Error, location: SourceSpan) {
		super(orgError, location);
	}
}

export { TCl3Error, TokenizerError, ParserError, SourceSpan, CompilerError };
