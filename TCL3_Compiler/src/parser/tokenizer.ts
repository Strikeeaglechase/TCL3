import { TokenizerError } from "../errors.js";
import { CharStream } from "../stream.js";

const topLevelKeywords = ["fn", "struct", "enum"];
const keywords = [...topLevelKeywords, "if", "else", "elif", "while", "for", "return", "let", "out", "break", "continue", "static"];
const operands = ["+", "-", "*", "/", "%", "|", "&", "^", "||", "&&", "!", "==", "!=", "<", ">", "<=", ">=", "~", ">>", "<<"];
const symbols = ["(", ")", "[", "]", "{", "}", ";", ",", ".", "=", ":", "->", "+=", "-=", "*=", "/=", "%=", "|=", "&=", "^="];
const selfAssignMathOps = ["+=", "-=", "*=", "/=", "%=", "&=", "|=", "^="];
const resultTypeIsBoolOperands = ["==", "!=", "<", ">", "<=", ">=", "&&", "||"];

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
const commentStart = "//";
const identifierStart = /[a-zA-Z_]/;
const identifierPart = /[a-zA-Z0-9_]/;
const numberLiteralStartChars = /[0-9.-]/;
const numberLiteralChars = /[0-9.]/;
const mainFnName = "main";

enum TokenType {
	Symbol = "symbol",
	Keyword = "keyword",
	LiteralNumber = "literalNumber",
	LiteralString = "literalString",
	LiteralChar = "literalChar",
	LiteralBool = "literalBool",
	Operator = "operator",
	Identifier = "identifier",
	Comment = "comment",
	PreprocessorDirective = "preprocessorDirective"
}

enum PreprocessDirectiveKind {
	Define = "define",
	Export = "export",
	Include = "include",
	Parameter = "parameter"
}

type NonPositionToken = Omit<Token, "start" | "end" | "fileIdentifier">;
interface Token {
	type: TokenType;
	value: string;
	start: number;
	end: number;
	fileIdentifier: string;
}

interface Include {
	path: string;
	typeParameters: string[];
	start: number;
	end: number;
}

interface Export {
	identifier: string;
	start: number;
	end: number;
}

interface TypeParameter {
	name: string;
	validTypes: string[];
	providedType: string;
}

interface TokenizeResult {
	tokens: Token[];
	exports: Export[];
	includes: Include[];
	typeParameters: TypeParameter[];
}

class Tokenizer {
	private charStream: CharStream;
	private defines: Map<string, Token[]> = new Map();
	private exports: Export[] = [];
	private includes: Include[] = [];
	private tokens: Token[] = [];
	private typeParameters: TypeParameter[] = [];

	public errors: TokenizerError[] = [];

	constructor(
		input: string,
		private inputTypeParams: string[],
		private throwOnError: boolean,
		private fileIdentifier: string
	) {
		this.charStream = new CharStream(input.split(""));
	}

	public tokenize(): TokenizeResult {
		while (!this.charStream.eof()) {
			const startPos = this.charStream.position;
			// May be multiple due to preprocessor define
			let tokens: NonPositionToken | NonPositionToken[];

			try {
				tokens = this.readToken();
			} catch (e) {
				const error = new TokenizerError(e, {
					startIndex: startPos,
					endIndex: this.charStream.position,
					fileIdentifier: this.fileIdentifier
				});
				this.errors.push(error);

				if (this.throwOnError) throw error;
				continue;
			}
			const endPos = this.charStream.position;

			// No tokens omitted for comments/defines/etc
			if (!tokens) continue;

			if (Array.isArray(tokens)) {
				const positionalTokens: Token[] = tokens.map(token => ({ ...token, start: startPos, end: endPos, fileIdentifier: this.fileIdentifier }));
				this.tokens.push(...positionalTokens);
			} else {
				this.tokens.push({ ...tokens, start: startPos, end: endPos, fileIdentifier: this.fileIdentifier });
			}
		}

		return { tokens: this.tokens, exports: this.exports, includes: this.includes, typeParameters: this.typeParameters };
	}

	private readToken(): NonPositionToken | NonPositionToken[] {
		const char = this.charStream.next();
		if (char.trim() == "") return null; // Skip whitespace

		if (char == preprocessorDirectiveStart) {
			return this.readPreprocessorDirective();
		}

		const pair = char + (this.charStream.eof() ? "" : this.charStream.peak());

		if (pair == commentStart) {
			const comment = this.charStream.readUntilAndConsume("\n"); // Skip single-line comment
			return { type: TokenType.Comment, value: commentStart + comment.join("") };
		}

		if (operands.includes(pair)) return this.processOperand(pair);
		if (symbols.includes(pair)) return this.processSymbol(pair);
		if (operands.includes(char)) return this.processOperand(char);
		if (symbols.includes(char)) return this.processSymbol(char);

		if (numberLiteralStartChars.test(char)) return this.processNumberLiteral(char);
		if (char == '"' || char == "'") return this.processStringLiteral(char);

		if (!identifierStart.test(char)) throw new Error(`Unexpected character: ${char}`);

		const identifier = char + this.charStream.readUntil(c => !identifierPart.test(c)).join("");
		if (this.defines.has(identifier)) {
			const defineTokens = this.defines.get(identifier);
			return defineTokens;
		}

		if (keywords.includes(identifier)) {
			return { type: TokenType.Keyword, value: identifier };
		}

		if (identifier == trueValue || identifier == falseValue) {
			return {
				type: TokenType.LiteralBool,
				value: identifier == trueValue ? "1" : "0"
			};
		}

		return { type: TokenType.Identifier, value: identifier };
	}

	private processStringLiteral(stringLitType: "'" | '"') {
		const stringLiteral = this.charStream.readUntilAndConsume(stringLitType).join("");
		if (stringLitType == "'") {
			if (stringLiteral.length > 1) throw new Error(`Invalid character literal: '${stringLiteral}'`);
			if (stringLiteral.length == 0) throw new Error(`Empty character literal: ''`);
			return { type: TokenType.LiteralChar, value: stringLiteral.charCodeAt(0).toString() };
		}

		return { type: TokenType.LiteralString, value: stringLiteral };
	}

	private processNumberLiteral(char: string) {
		const numberLiteral = char + this.charStream.readUntil(c => !numberLiteralChars.test(c)).join("");
		return { type: TokenType.LiteralNumber, value: numberLiteral };
	}

	private processOperand(charOrPair: string) {
		if (charOrPair.length == 2) this.charStream.next(); // consume the second character of the pai

		const token: NonPositionToken = {
			type: TokenType.Operator,
			value: charOrPair
		};
		return token;
	}

	private processSymbol(charOrPair: string) {
		if (charOrPair.length == 2) this.charStream.next(); // consume the second character of the pair

		const token: NonPositionToken = {
			type: TokenType.Symbol,
			value: charOrPair
		};

		return token;
	}

	private readPreprocessorDirective() {
		const preprocessor = this.charStream.readUntil(char => char == " " || char == "\n").join("");
		this.charStream.next(); // Skip the space after the preprocessor directive
		switch (preprocessor) {
			case PreprocessDirectiveKind.Define:
				const defineName = this.charStream.readUntilAndConsume(" ").join("");
				const defineValue = this.charStream.readUntilAndConsume("\n").join("").trim();
				if (this.defines.has(defineName)) throw new Error(`Redefinition of preprocessor define: ${defineName}`);

				const { tokens: defineTokens } = new Tokenizer(defineValue, [], this.throwOnError, ``).tokenize();
				this.defines.set(defineName, defineTokens);

				return { type: TokenType.PreprocessorDirective, value: `${preprocessorDirectiveStart}${preprocessor} ${defineName} ${defineValue}` };
			case PreprocessDirectiveKind.Export:
				const exportStart = this.charStream.position;
				const exportListLine = this.charStream.readUntilAndConsume("\n").join("").trim();
				const exportList = exportListLine.split(",").map(s => s.trim());
				this.exports.push(...exportList.map(identifier => ({ identifier: identifier, start: exportStart, end: this.charStream.position })));
				return { type: TokenType.PreprocessorDirective, value: `${preprocessorDirectiveStart}${preprocessor} ${exportListLine}` };
			case PreprocessDirectiveKind.Include:
				const includeStart = this.charStream.position;
				const includeFile = this.charStream.readUntilAndConsume("\n").join("").trim();
				const [_, path, typeParamsList] = includeFile.match(/"(.+)"(?: <(.+)>)?/) || [];
				if (!path) throw new Error(`Invalid include directive: ${includeFile}`);

				const typeParams = (typeParamsList || "")
					.split(",")
					.map(s => s.trim())
					.filter(s => s.length > 0);

				this.includes.push({
					path: path,
					typeParameters: typeParams,
					start: includeStart,
					end: this.charStream.position
				});
				return { type: TokenType.PreprocessorDirective, value: `${preprocessorDirectiveStart}${preprocessor} ${includeFile}` };
			case PreprocessDirectiveKind.Parameter:
				const paramLine = this.charStream.readUntilAndConsume("\n").join("").trim();
				const [__, paramName, validTypeList] = paramLine.match(/(.+): (.+)/) || [];
				if (!paramName || !validTypeList) throw new Error(`Invalid parameter directive: ${paramLine}`);

				const validTypes = validTypeList
					.split(",")
					.map(s => s.trim())
					.filter(s => s.length > 0);

				const typeParam: TypeParameter = {
					name: paramName,
					validTypes: validTypes,
					providedType: this.inputTypeParams[this.typeParameters.length]
				};
				this.typeParameters.push(typeParam);

				if (!typeParam.providedType) throw new Error(`Missing input type parameter for ${paramName}`);

				this.charStream.findAndReplace(`%${typeParam.name}%`, typeParam.providedType);

				return { type: TokenType.PreprocessorDirective, value: `${preprocessorDirectiveStart}${preprocessor} ${paramLine}` };
			default:
				throw new Error(`Unknown preprocessor directive: ${preprocessor}`);
		}
	}

	public static generateDebug(tokens: Token[]): string {
		const padLen = TokenType.Identifier.length;
		return tokens
			.map(token => `${token.start.toString().padStart(4, " ")}:${token.end.toString().padEnd(4, " ")} ${token.type.padEnd(padLen)} ${token.value}`)
			.join("\n");
	}
}

export {
	Tokenizer,
	TokenType,
	Token,
	TokenizeResult,
	Include,
	Export,
	TypeParameter,
	operandPrecedence,
	selfAssignMathOps,
	resultTypeIsBoolOperands,
	preprocessorDirectiveStart,
	mainFnName,
	keywords,
	topLevelKeywords
};
