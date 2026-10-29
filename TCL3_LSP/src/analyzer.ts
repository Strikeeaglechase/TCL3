import chalk from "chalk";
import path from "path";
import { Compiler } from "tlc3/compiler/compiler.js";
import { TCl3Error } from "tlc3/errors.js";
import { Linker } from "tlc3/linker/linker.js";
import { AST, ASTType, Program } from "tlc3/parser/ast.js";
import { Token, TokenType } from "tlc3/parser/tokenizer.js";
import { walk } from "tlc3/parser/walker.js";

import { SemanticTokenTypes } from "./extraLspTypes.js";
import { LSP } from "./index.js";
import { Position } from "./lspTypes/api.js";

interface TokenTypeRange {
	start: number;
	end: number;
	type: SemanticTokenTypes;
	fileIdentifier: string;
}

type ILocatable =
	| {
			endIndex: number;
			startIndex: number;
			fileIdentifier: string;
	  }
	| {
			location: {
				startIndex: number;
				endIndex: number;
				fileIdentifier: string;
			};
	  }
	| {
			start: number;
			end: number;
			fileIdentifier: string;
	  };

function normalizeLocatable(loc: ILocatable): { start: number; end: number; fileIdentifier: string } {
	if (loc == null) {
		throw new Error("Location is null or undefined");
	}

	if ("location" in loc) {
		return { start: loc.location.startIndex, end: loc.location.endIndex, fileIdentifier: loc.location.fileIdentifier };
	} else if ("start" in loc && "end" in loc) {
		return { start: loc.start, end: loc.end, fileIdentifier: loc.fileIdentifier };
	} else {
		return { start: loc.startIndex, end: loc.endIndex, fileIdentifier: loc.fileIdentifier };
	}
}

const keywordAt = (kw: string, location: ILocatable): TokenTypeRange => {
	const loc = normalizeLocatable(location);
	return {
		start: loc.start,
		end: loc.start + kw.length,
		type: SemanticTokenTypes.keyword,
		fileIdentifier: loc.fileIdentifier
	};
};

const tokenAt = (type: SemanticTokenTypes, location: ILocatable): TokenTypeRange => {
	const loc = normalizeLocatable(location);
	return {
		...loc,
		type: type
	};
};

class Analyzer {
	private readonly linker: Linker;
	private readonly program: Program;
	private readonly compiler: Compiler;

	private tokenTypeRanges: TokenTypeRange[] = [];
	private tokens: Token[] = [];

	constructor(
		private lsp: LSP,
		configPath: string,
		readFile: (filePath: string) => string
	) {
		const buildArtifacts = Linker.build(configPath, readFile);
		this.linker = buildArtifacts.linker;
		this.program = buildArtifacts.program;
		this.compiler = buildArtifacts.compiler;

		this.loadTokensFromAllFiles();
		this.buildTokenTypeRanges();
	}

	private loadTokensFromAllFiles() {
		this.linker.files.forEach(file => this.tokens.push(...file.getTokens()));
	}

	public getTokenTypeRanges(fileUri: string): TokenTypeRange[] {
		const targetFile = this.linker.getFileByUri(fileUri);
		if (!targetFile) throw new Error(`File not found for URI: ${fileUri}`);

		const targetFileRanges = this.tokenTypeRanges.filter(r => r.fileIdentifier == targetFile.identifier);
		const nonOverlappingRanges: TokenTypeRange[] = [];
		const sortedRanges = targetFileRanges.sort((a, b) => a.start - b.start);

		for (const range of sortedRanges) {
			if (nonOverlappingRanges.length == 0 || range.start >= nonOverlappingRanges[nonOverlappingRanges.length - 1].end) {
				nonOverlappingRanges.push(range);
			}
		}

		return nonOverlappingRanges;
	}

	public getHoverDetailAtIndex(fileUri: string, index: number): { detail: string; start: number; end: number } {
		const targetFile = this.linker.getFileByUri(fileUri);
		if (!targetFile) throw new Error(`File not found for URI: ${fileUri}`);
		const hoveredToken = this.tokens.find(token => token.fileIdentifier == targetFile.identifier && token.start <= index && token.end >= index);
		if (!hoveredToken) {
			return {
				detail: "No token found at this position",
				start: index,
				end: index
			};
		}

		const tokenDetail = this.compiler.getTokenDetail(hoveredToken);
		if (!tokenDetail) {
			return {
				detail: "No detail information available for this token",
				start: hoveredToken.start,
				end: hoveredToken.end
			};
		}

		const detail = tokenDetail.getHoverDetail();
		if (!detail) return null;
		return {
			// detail: `${tokenDetail.nameToken.value}: ${typeToStr(tokenDetail.typeRef)} (${tokenDetail.constructor.name})`,
			detail: `\`\`\`rust\n${detail}\n\`\`\``,
			start: hoveredToken.start,
			end: hoveredToken.end
		};
	}

	private buildTokenTypeRanges() {
		walk(this.program, node => {
			this.tokenTypeRanges.push(...this.getTokenTypeRangeFromNode(node));
		});

		// Add comment token ranges
		this.tokens.forEach(token => {
			if (token.type != TokenType.Comment) return;

			this.tokenTypeRanges.push({
				start: token.start,
				end: token.end,
				type: SemanticTokenTypes.comment,
				fileIdentifier: token.fileIdentifier
			});
		});
	}

	private getTokenTypeRangeFromNode(node: AST): TokenTypeRange[] {
		switch (node.type) {
			case ASTType.StructDeclaration:
				return [
					keywordAt("struct", node.location),
					tokenAt(SemanticTokenTypes.type, node.nameToken),
					...node.fields.map(field => tokenAt(SemanticTokenTypes.property, field.nameToken))
				];

			case ASTType.RawTypeRef:
				return [tokenAt(SemanticTokenTypes.type, node.rawTypeToken)];

			case ASTType.FunctionDeclaration:
				return [
					...(node.static ? [keywordAt("static", node.staticKeyword)] : []),
					keywordAt("fn", node.location),
					tokenAt(SemanticTokenTypes.function, node.nameToken),
					...node.parameters.map(param => tokenAt(SemanticTokenTypes.parameter, param.nameToken))
				];

			case ASTType.VariableDeclaration:
				if (!node.location) return []; // Special case variable declaration inserted by the compiler
				return [keywordAt("let", node.location), tokenAt(SemanticTokenTypes.variable, node.nameToken)];

			case ASTType.StructFieldInitializer:
				return [tokenAt(SemanticTokenTypes.property, node.nameToken)];

			// Needs proper analysis for determining exact referenced type, not a right now problem!
			case ASTType.Reference:
				return [tokenAt(SemanticTokenTypes.variable, node.identifierToken)];

			case ASTType.ReturnStatement:
				return [keywordAt("return", node.location)];

			case ASTType.Literal:
				switch (node.literalType) {
					case TokenType.LiteralString:
						return [tokenAt(SemanticTokenTypes.string, node.location)];
					case TokenType.LiteralNumber:
						return [tokenAt(SemanticTokenTypes.number, node.location)];
					case TokenType.LiteralChar:
						return [tokenAt(SemanticTokenTypes.string, node.location)];
					default:
						throw new Error(`Unhandled literal type: ${node.literalType}`);
				}

			case ASTType.Out:
				return [keywordAt("out", node.location)];

			case ASTType.ContinueStatement:
				return [keywordAt("continue", node.location)];

			case ASTType.BreakStatement:
				return [keywordAt("break", node.location)];

			case ASTType.IfStatement:
				return [
					keywordAt("if", node.location),
					...node.elseIfs.map(elseIf => keywordAt("elif", elseIf.location)),
					...(node.elseBody ? [keywordAt("else", node.elseBody)] : [])
				];

			case ASTType.ForLoop:
				return [keywordAt("for", node.location)];

			case ASTType.WhileLoop:
				return [keywordAt("while", node.location)];

			case ASTType.FunctionTypeRef:
				return [keywordAt("fn", node.location)];

			case ASTType.EnumDeclaration:
				return [keywordAt("enum", node.location), tokenAt(SemanticTokenTypes.type, node.nameToken)];

			case ASTType.VariableAssignment:
			case ASTType.FunctionCall:
			case ASTType.TypeCast:
			case ASTType.Dereference:
			case ASTType.AddressOf:
			case ASTType.Block:
			case ASTType.UnaryExpression:
			case ASTType.Semicolon:
			case ASTType.BinaryExpression:
			case ASTType.Initializer:
			case ASTType.WrappedTypeRef:
			case ASTType.Program:
				return [];
			default:
				throw new Error(`Unhandled node type: ${(node as any).type}`);
		}
	}

	public getErrors() {
		const fileIdentToUri: Map<string, string> = new Map();
		const errors: Map<string, Array<{ message: string; range: { start: Position; end: Position } }>> = new Map();

		this.linker.files.forEach(file => {
			fileIdentToUri.set(file.identifier, file.filePath);
			errors.set(file.filePath, []);
		});

		const registerError = (error: TCl3Error) => {
			const filePath = fileIdentToUri.get(error.location.fileIdentifier);
			const errorDocument = this.lsp.getDocument(filePath);

			errors.get(filePath).push({
				message: error.cause.message,
				range: {
					start: errorDocument.indexToPosition(error.location.startIndex),
					end: errorDocument.indexToPosition(error.location.endIndex)
				}
			});
		};

		this.linker.getErrors().forEach(error => registerError(error));
		this.compiler.errors.forEach(error => registerError(error));

		return errors;
	}
}

export { Analyzer };
