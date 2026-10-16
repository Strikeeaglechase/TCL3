class TokenizerError {
	constructor(
		public readonly message: string,
		public readonly index: number
	) {}
}

export { TokenizerError };
