import path from "path";
import { AST, ASTType, Program } from "tlc3/parser/ast.js";
import { Linker } from "tlc3/parser/linker.js";
import { TokenType } from "tlc3/parser/tokenizer.js";
import { walk } from "tlc3/parser/walker.js";

import { SemanticTokenTypes } from "./extraLspTypes.js";

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

	public tokenTypeRanges: TokenTypeRange[] = [];

	constructor(entryFile: string, readFile: (filePath: string) => string) {
		this.linker = new Linker(entryFile, {
			readFile,
			pathResolver: path => path,
			throwOnError: false
		});
		this.program = this.linker.link();

		this.buildTokenTypeRanges();
	}

	public getTokenTypeRanges(): TokenTypeRange[] {
		const targetFileRanges = this.tokenTypeRanges.filter(r => r.fileIdentifier == this.linker.entryFile.identifier);
		const nonOverlappingRanges: TokenTypeRange[] = [];
		const sortedRanges = targetFileRanges.sort((a, b) => a.start - b.start);

		for (const range of sortedRanges) {
			if (nonOverlappingRanges.length == 0 || range.start >= nonOverlappingRanges[nonOverlappingRanges.length - 1].end) {
				nonOverlappingRanges.push(range);
			}
		}

		return nonOverlappingRanges;
	}

	private buildTokenTypeRanges() {
		walk(this.program, node => {
			this.tokenTypeRanges.push(...this.getTokenTypeRangeFromNode(node));
		});

		// Add comment token ranges
		this.linker.entryFile.getTokens().forEach(token => {
			if (token.type != TokenType.Comment) return;

			this.tokenTypeRanges.push({
				start: token.start,
				end: token.end,
				type: SemanticTokenTypes.comment,
				fileIdentifier: this.linker.entryFile.identifier
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
}

export { Analyzer };
