import { Stream } from "../stream.js";

const keywords = ["if", "else", "elif", "while", "for", "return", "fn", "let", "struct", "enum", "out", "break", "continue", "static"];
const operands = ["+", "-", "*", "/", "%", "|", "&", "^", "||", "&&", "!", "==", "!=", "<", ">", "<=", ">=", "~", ">>", "<<"];
const symbols = ["(", ")", "[", "]", "{", "}", ";", ",", ".", "=", ":", "->", "+=", "-=", "*=", "/=", "%=", "|=", "&=", "^=", ">>=", "<<="];

const operandPrecedence: Record<string, number> = {
	"!": 1,
	"~": 1,
	"*": 3,
	"/": 3,
	"%": 3,
	"+": 4,
	"-": 4,
	"<<": 5,
	">>": 5,
	"<": 6,
	"<=": 6,
	">": 6,
	">=": 6,
	"==": 7,
	"!=": 7,
	"&": 8,
	"^": 9,
	"|": 10,
	"&&": 11,
	"||": 12
};

const trueValue = "true";
const falseValue = "false";
const preprocessorDirectiveStart = "#";

const identifierStart = /[a-zA-Z_]/;
const identifierPart = /[a-zA-Z0-9_]/;
const numberLiteralChars = /[0-9.-]/;

enum TokenType {
	Symbol = "symbol",
	Keyword = "keyword",
	LiteralNumber = "literalNumber",
	LiteralString = "literalString",
	Operator = "operator",
	Identifier = "identifier"
}

interface Token {
	type: TokenType;
	value: string;
}

class Tokenizer {
	private charStream: Stream<string>;
	private defines: Map<string, Token[]> = new Map();
	private exports: string[] = [];
	private includes: string[] = [];
	private tokens: Token[] = [];

	constructor(private input: string) {
		this.charStream = new Stream(input.split(""));
	}

	public tokenize() {
		while (!this.charStream.eof()) this.readToken();

		return { tokens: this.tokens, exports: this.exports, includes: this.includes };
	}

	private readToken() {
		const char = this.charStream.next();
		if (char.trim() == "") return; // Skip whitespace

		if (char == preprocessorDirectiveStart) {
			this.readPreprocessorDirective();
			return;
		}

		const pair = char + (this.charStream.eof() ? "" : this.charStream.peak());

		if (pair == "//") {
			this.charStream.readUntilAndConsume("\n"); // Skip single-line comment
			return;
		}

		if (operands.includes(pair)) return this.processOperand(pair);
		if (symbols.includes(pair)) return this.processSymbol(pair);
		if (operands.includes(char)) return this.processOperand(char);
		if (symbols.includes(char)) return this.processSymbol(char);

		if (numberLiteralChars.test(char)) return this.processNumberLiteral(char);
		if (char == '"' || char == "'") return this.processStringLiteral(char);

		if (!identifierStart.test(char)) throw new Error(`Unexpected character: ${char}`);

		const identifier = char + this.charStream.readUntil(c => !identifierPart.test(c)).join("");
		if (this.defines.has(identifier)) {
			const defineTokens = this.defines.get(identifier);
			this.tokens.push(...defineTokens);
			return;
		}

		if (keywords.includes(identifier)) {
			this.tokens.push({ type: TokenType.Keyword, value: identifier });
			return;
		}

		if (identifier == trueValue || identifier == falseValue) {
			this.tokens.push({ type: TokenType.LiteralNumber, value: identifier == trueValue ? "1" : "0" });
			return;
		}

		this.tokens.push({ type: TokenType.Identifier, value: identifier });
	}

	private processStringLiteral(stringLitType: "'" | '"') {
		const stringLiteral = this.charStream.readUntilAndConsume(stringLitType).join("");
		if (stringLitType == "'") {
			if (stringLiteral.length > 1) throw new Error(`Invalid character literal: '${stringLiteral}'`);
			this.tokens.push({ type: TokenType.LiteralNumber, value: stringLiteral.charCodeAt(0).toString() });
			return;
		}

		this.tokens.push({ type: TokenType.LiteralString, value: `"${stringLiteral}"` });
	}

	private processNumberLiteral(char: string) {
		const numberLiteral = char + this.charStream.readUntil(c => !numberLiteralChars.test(c)).join("");
		this.tokens.push({ type: TokenType.LiteralNumber, value: numberLiteral });
	}

	private processOperand(charOrPair: string) {
		if (charOrPair.length == 2) this.charStream.next(); // consume the second character of the pai

		const token: Token = {
			type: TokenType.Operator,
			value: charOrPair
		};
		this.tokens.push(token);
	}

	private processSymbol(charOrPair: string) {
		if (charOrPair.length == 2) this.charStream.next(); // consume the second character of the pair

		const token: Token = {
			type: TokenType.Symbol,
			value: charOrPair
		};

		this.tokens.push(token);
	}

	private readPreprocessorDirective() {
		const preprocessor = this.charStream.readUntilAndConsume(" ").join("");
		switch (preprocessor) {
			case "define":
				const defineName = this.charStream.readUntilAndConsume(" ").join("");
				const defineValue = this.charStream.readUntilAndConsume("\n").join("").trim();
				if (this.defines.has(defineName)) throw new Error(`Redefinition of preprocessor define: ${defineName}`);

				const { tokens: defineTokens } = new Tokenizer(defineValue).tokenize();
				this.defines.set(defineName, defineTokens);
				break;
			case "export":
				const exportListLine = this.charStream.readUntilAndConsume("\n").join("").trim();
				const exportList = exportListLine.split(",").map(s => s.trim());
				this.exports.push(...exportList);
				break;
			case "include":
				const includeFile = this.charStream.readUntilAndConsume("\n").join("").trim();
				this.includes.push(includeFile);
				break;
			default:
				throw new Error(`Unknown preprocessor directive: ${preprocessor}`);
		}
	}

	public static generateDebug(tokens: Token[]): string {
		const padLen = TokenType.Identifier.length;
		return tokens.map(token => `${token.type.padEnd(padLen)} ${token.value}`).join("\n");
	}
}

export { Tokenizer, TokenType, Token, operandPrecedence };
