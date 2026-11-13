import chalk from "chalk";
import fs from "fs";
import path from "path";
import { Compiler, TokenDetailInfo, VariableDetailInformation } from "tlc3/compiler/compiler.js";
import { FunctionListDetailInformation } from "tlc3/compiler/detail.js";
import { FunctionContext } from "tlc3/compiler/functionContext.js";
import { primitiveTypeNames, typeToStr } from "tlc3/compiler/types.js";
import { Enum, Struct } from "tlc3/compiler/userTypes.js";
import { TCl3Error } from "tlc3/errors.js";
import { Linker } from "tlc3/linker/linker.js";
import { TargetFile } from "tlc3/linker/targetFile.js";
import { AST, ASTType, ASTTypeRef, FunctionCall, FunctionDeclaration, Program, VariableDeclaration } from "tlc3/parser/ast.js";
import { keywords, Token, TokenType, topLevelKeywords } from "tlc3/parser/tokenizer.js";
import { walk } from "tlc3/parser/walker.js";

import { Document } from "./document.js";
import { CompletionItemKind, SemanticTokenTypes, SymbolKind } from "./extraLspTypes.js";
import { LSP } from "./index.js";
import {
	CompletionItem,
	DefinitionLink,
	DocumentHighlight,
	DocumentSymbol,
	InlayHint,
	Position,
	Range,
	SignatureHelp,
	SignatureInformation,
	WorkspaceEdit
} from "./lspTypes/api.js";

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

function getTopLevelKeywordCompletions(): CompletionItem[] {
	return topLevelKeywords.map(kw => {
		return {
			label: kw,
			kind: CompletionItemKind.Keyword
		};
	});
}

class Analyzer {
	private readonly linker: Linker;
	private readonly program: Program;
	private readonly compiler: Compiler;

	private tokenTypeRanges: TokenTypeRange[] = [];
	private tokens: Token[] = [];

	private flatAst: AST[] = [];

	constructor(
		private lsp: LSP,
		configPath: string,
		readFile: (filePath: string) => string
	) {
		const buildArtifacts = Linker.build(configPath, readFile);
		this.linker = buildArtifacts.linker;
		this.program = buildArtifacts.program;
		this.compiler = buildArtifacts.compiler;

		// This is used to help resolve function signature information, however, doing a find over every single ast node in the entire linked project seems really inefficient
		walk(this.program, node => {
			this.flatAst.push(node);
		});

		this.loadTokensFromAllFiles();
		this.buildTokenTypeRanges();
	}

	private loadTokensFromAllFiles() {
		this.linker.files.forEach(file => this.tokens.push(...file.getTokens()));
	}

	private getTokenDetailAtIndex(fileIdentifier: string, index: number): { detail: TokenDetailInfo; token: Token } {
		const hoveredToken = this.tokens.find(token => token.fileIdentifier == fileIdentifier && token.start <= index && token.end >= index);
		if (!hoveredToken) return { detail: null, token: null };

		return { detail: this.compiler.getTokenDetail(hoveredToken), token: hoveredToken };
	}

	public getHoverDetailAtIndex(fileUri: string, index: number): { detail: string; start: number; end: number } {
		const targetFile = this.linker.getFileByUri(fileUri);
		if (!targetFile) return null;

		const { detail, token } = this.getTokenDetailAtIndex(targetFile.identifier, index);
		if (!detail) return null;

		const detailText = detail.getHoverDetail();
		if (!detailText) return null;

		return {
			detail: `\`\`\`rust\n${detailText}\n\`\`\``,
			start: token.start,
			end: token.end
		};
	}

	public getDocumentHighlights(fileUri: string, position: Position): DocumentHighlight[] {
		const file = this.linker.getFileByUri(fileUri);
		if (!file) return [];
		const document = this.lsp.getDocument(fileUri);

		const index = document.positionToIndex(position);
		const { detail } = this.getTokenDetailAtIndex(file.identifier, index);
		if (!detail) return [];

		const allMatchingDetails = this.compiler.getTokenDetailsMatchingRefId(detail.refId);

		const highlights: DocumentHighlight[] = allMatchingDetails
			.filter(detail => detail.token.fileIdentifier == file.identifier)
			.map(matchingDetail => {
				return {
					range: {
						start: document.indexToPosition(matchingDetail.token.start),
						end: document.indexToPosition(matchingDetail.token.end)
					}
				};
			});

		return highlights;
	}

	public getDefinitionForPosition(fileUri: string, position: Position): DefinitionLink {
		const file = this.linker.getFileByUri(fileUri);
		if (!file) return null;
		const document = this.lsp.getDocument(fileUri);

		const index = document.positionToIndex(position);

		const { detail } = this.getTokenDetailAtIndex(file.identifier, index);
		if (!detail) return null;

		if (detail instanceof FunctionContext || detail instanceof Struct) {
			const defFile = this.linker.getFileByIdentifier(detail.definition.location.fileIdentifier);
			const defDocument = this.lsp.getDocument(defFile.filePath);

			const link: DefinitionLink = {
				targetUri: defFile.filePath,
				targetRange: {
					start: defDocument.indexToPosition(detail.definition.nameToken.start),
					end: defDocument.indexToPosition(detail.definition.bodyEndIndex)
				},
				targetSelectionRange: {
					start: defDocument.indexToPosition(detail.definition.nameToken.start),
					end: defDocument.indexToPosition(detail.definition.nameToken.end)
				}
			};

			return link;
		}

		if (detail instanceof VariableDetailInformation) {
			const defDetail = this.compiler.getDefinitionForRefId(detail.refId);
			if (!defDetail) return null;

			const defFile = this.linker.getFileByIdentifier(defDetail.token.fileIdentifier);
			const defDocument = this.lsp.getDocument(defFile.filePath);

			const link: DefinitionLink = {
				targetUri: defFile.filePath,
				targetRange: {
					start: defDocument.indexToPosition(defDetail.token.start),
					end: defDocument.indexToPosition(defDetail.token.end)
				},
				targetSelectionRange: {
					start: defDocument.indexToPosition(defDetail.token.start),
					end: defDocument.indexToPosition(defDetail.token.end)
				}
			};

			return link;
		}

		return null;
	}

	private getDetailsOfSymbolsAvailableAt(document: Document, file: TargetFile, position: Position) {
		const index = document.positionToIndex(position);

		const globalSymbolTokens = file.getGlobalSymbolsAvailable();
		const globalSymbols = globalSymbolTokens.map(token => {
			const detail = this.compiler.getTokenDetail(token);

			if (!detail) console.log(`No detail resolved for: ${token.value}`);

			return detail;
		});

		const context = this.compiler.getContextAtIndex(index);
		// Not in function, can only be creating a struct, function, or enum
		if (!context) return globalSymbols;
		const contextSymbols = context.getAutocompleteSymbols();

		const allSymbols = [...contextSymbols, ...globalSymbols].filter(symbol => symbol != null);
		return allSymbols;
	}

	private getNonTriggerCharAutoComplete(document: Document, file: TargetFile, position: Position): CompletionItem[] {
		const allSymbols = this.getDetailsOfSymbolsAvailableAt(document, file, position);
		if (!allSymbols) return getTopLevelKeywordCompletions();

		const completionItems: CompletionItem[] = allSymbols.map(symbol => {
			if (!symbol) return null;
			return {
				label: symbol.nameToken.value,
				detail: symbol.getHoverDetail(),
				kind: symbol instanceof FunctionContext ? CompletionItemKind.Function : CompletionItemKind.Variable
			};
		});

		const completionKeywords: CompletionItem[] = keywords.map(kw => {
			return {
				label: kw,
				kind: CompletionItemKind.Keyword
			};
		});

		return [...completionItems, ...completionKeywords];
	}

	private getPreviousTokenBeforePosition(document: Document, file: TargetFile, position: Position): Token {
		const token = this.tokens.find(
			t => t.fileIdentifier == file.identifier && t.start <= document.positionToIndex(position) - 1 && t.end >= document.positionToIndex(position) - 1
		);

		return token;
	}

	public getCompletionsForPosition(fileUri: string, position: Position, triggerCharacter?: string): CompletionItem[] {
		const file = this.linker.getFileByUri(fileUri);
		if (!file) return [];
		const document = this.lsp.getDocument(fileUri);

		// Simple check for local variables/functions/etc. Everything in context
		if (!triggerCharacter) return this.getNonTriggerCharAutoComplete(document, file, position);

		if (triggerCharacter == " ") {
			const prevToken = this.getPreviousTokenBeforePosition(document, file, position);
			if (prevToken) triggerCharacter = prevToken.value;
		}

		if (triggerCharacter == ":") {
			const symbols = this.getDetailsOfSymbolsAvailableAt(document, file, position);
			// console.log(symbols);
			if (!symbols) return [];

			const typeSymbols = symbols.filter(symbol => symbol instanceof Struct || symbol instanceof Enum);
			const builtinTypeCompletions: CompletionItem[] = primitiveTypeNames.map(typeName => {
				return {
					kind: CompletionItemKind.Keyword,
					label: typeName
				};
			});

			const typeCompletions: CompletionItem[] = typeSymbols.map(symbol => {
				return {
					kind: CompletionItemKind.Class,
					label: symbol.nameToken.value
				};
			});

			return [...typeCompletions, ...builtinTypeCompletions];
		}

		if (triggerCharacter != ".") return [];

		// Get token before trigger character
		const token = this.getPreviousTokenBeforePosition(document, file, position);
		if (!token) return [];

		const detail = this.compiler.getTokenDetail(token);
		if (!detail) return [];

		// Static function calls
		if (detail instanceof Struct) {
			const staticMethods: FunctionContext[] = [];
			detail.methods.forEach(methodList => {
				methodList.forEach(method => {
					if (method.isStatic) staticMethods.push(method);
				});
			});

			const staticMethodCompletions: CompletionItem[] = staticMethods.map(method => {
				return {
					kind: CompletionItemKind.Method,
					label: method.nameToken.value,
					detail: method.getHoverDetail()
				};
			});

			return staticMethodCompletions;
		}

		// Enum variants
		if (detail instanceof Enum) {
			const enumVariantCompletions: CompletionItem[] = [];
			detail.variants.forEach((variant, name) => {
				enumVariantCompletions.push({
					kind: CompletionItemKind.EnumMember,
					label: name,
					detail: `(variant) ${detail.nameToken.value}::${name}`
				});
			});
		}

		// Field ref
		if (detail instanceof VariableDetailInformation) {
			const type = detail.typeRef;
			if (type.type != ASTType.RawTypeRef) {
				console.log(`Non raw ref: `, type);
				return [];
			}

			const struct = this.compiler.structs.get(type.rawType);
			const completions: CompletionItem[] = [];
			struct.fields.forEach((field, name) => {
				completions.push({
					kind: CompletionItemKind.Property,
					label: name,
					detail: Struct.getHoverDetailOfField(field)
				});
			});

			struct.methods.forEach(methodList => {
				methodList.forEach(method => {
					completions.push({
						kind: CompletionItemKind.Method,
						label: method.nameToken.value,
						detail: method.getHoverDetail()
					});
				});
			});

			return completions;
		}

		console.log(`Unhandled detail type: ${detail.constructor.name}`, detail);
		return [];
	}

	private getFunctionSignature(name: string, parameters: { nameToken: Token; type: ASTTypeRef }[], returnType: ASTTypeRef): SignatureInformation {
		let label = `${name}(`;

		label += parameters
			.map((param, idx) => {
				if (idx == 0 && param.nameToken?.value == "this") return null;
				return `${param.nameToken.value}: ${typeToStr(param.type)}`;
			})
			.filter(param => param != null)
			.join(", ");

		label += `): ${typeToStr(returnType)}`;
		return {
			label: label,
			// documentation: func.getHoverDetail(),
			parameters: parameters.map(param => {
				return {
					label: `${param.nameToken.value}: ${typeToStr(param.type)}`
				};
			})
		};
	}

	public getFunctionSignatureHelp(fileUri: string, position: Position): SignatureHelp {
		const file = this.linker.getFileByUri(fileUri);
		if (!file) return null;
		const document = this.lsp.getDocument(fileUri);

		const positionIndex = document.positionToIndex(position);
		// fs.writeFileSync("../temp.json", this.flatAst.map(n => JSON.stringify(n)).join("\n"));
		// fs.writeFileSync("../temp.json", JSON.stringify(this.program, null, 2));
		// fs.writeFileSync("../temp.txt", file.content);
		const callAst = this.flatAst.find(
			node =>
				node.type == ASTType.FunctionCall &&
				node.location.fileIdentifier == file.identifier &&
				node.location.startIndex <= positionIndex &&
				node.location.endIndex >= positionIndex
		) as FunctionCall;

		if (!callAst) return null;

		let callToken: Token;
		// if (callAst) {
		let tailOfReference = callAst.reference;
		while (tailOfReference.child != null) tailOfReference = tailOfReference.child;

		callToken = tailOfReference.identifierToken;
		// } else {
		// 	callToken = this.getPreviousTokenBeforePosition(document, file, position);
		// }

		if (!callToken) return null;

		const detail = this.compiler.getTokenDetail(callToken);
		const validDetailType =
			detail instanceof FunctionContext || detail instanceof FunctionListDetailInformation || detail instanceof VariableDetailInformation;
		if (!validDetailType) return null;

		if (detail instanceof FunctionContext) {
			const activeAstParameterIndex = callAst.arguments.findIndex((arg, idx) => {
				if (idx == callAst.arguments.length - 1) return true; // If the cursor is after the last argument, we want to show the last parameter as active
				return arg?.location.startIndex <= positionIndex && arg?.location.endIndex >= positionIndex;
			});
			const activeIndex = activeAstParameterIndex == -1 ? callAst.arguments.length : activeAstParameterIndex;
			const thisArgOffset = detail.definition.parameters.length > 0 && detail.definition.parameters[0].nameToken?.value == "this" ? 1 : 0;
			const activeParameterIndex = activeIndex - thisArgOffset;

			return {
				signatures: [this.getFunctionSignature(detail.nameToken.value, detail.definition.parameters, detail.typeRef.returnType)],
				activeParameter: activeParameterIndex
			};
		}

		if (detail instanceof VariableDetailInformation) {
			if (detail.typeRef.type != ASTType.FunctionTypeRef) return null;

			const activeAstParameterIndex = callAst.arguments.findIndex((arg, idx) => {
				if (idx == callAst.arguments.length - 1) return true; // If the cursor is after the last argument, we want to show the last parameter as active
				return arg?.location.startIndex <= positionIndex && arg?.location.endIndex >= positionIndex;
			});
			const activeIndex = activeAstParameterIndex == -1 ? callAst.arguments.length : activeAstParameterIndex;
			const thisArgOffset = detail.typeRef.parameters.length > 0 && detail.typeRef.parameters[0].nameToken?.value == "this" ? 1 : 0;
			const activeParameterIndex = activeIndex - thisArgOffset;

			return {
				signatures: [this.getFunctionSignature(detail.nameToken.value, detail.typeRef.parameters, detail.typeRef.returnType)],
				activeParameter: activeParameterIndex
			};
		}

		if (detail instanceof FunctionListDetailInformation) {
			// Identify best matching function based on parameter types

			const scored = detail.functions.map(func => {
				let score = 0;

				const argCountDelta = Math.abs(func.definition.parameters.length - callAst.arguments.length);
				score -= argCountDelta;

				func.definition.parameters.forEach((param, idx) => {
					// In order to infer type for references need the correct context to be set
					this.compiler.currentContext = detail.currentContext;
					const callType = this.compiler.inferTypeFrom(callAst.arguments[idx]);
					this.compiler.currentContext = null;
					if (this.compiler.areTypesEqual(param.type, callType)) {
						score += 2;
					} else {
						score -= 1;
					}
				});

				return {
					func: func,
					score: score
				};
			});

			scored.sort((a, b) => b.score - a.score);

			const selectedFunc = scored[0].func;
			const selectedFuncIndex = detail.functions.findIndex(func => func === selectedFunc);

			const activeAstParameterIndex = callAst.arguments.findIndex((arg, idx) => {
				if (idx == callAst.arguments.length - 1) return true; // If the cursor is after the last argument, we want to show the last parameter as active
				return arg?.location.startIndex <= positionIndex && arg?.location.endIndex >= positionIndex;
			});
			const activeIndex = activeAstParameterIndex == -1 ? callAst.arguments.length : activeAstParameterIndex;
			const thisArgOffset = selectedFunc.definition.parameters.length > 0 && selectedFunc.definition.parameters[0].nameToken?.value == "this" ? 1 : 0;
			const activeParameterIndex = activeIndex - thisArgOffset;

			return {
				signatures: detail.functions.map(func => {
					return this.getFunctionSignature(func.nameToken.value, func.definition.parameters, func.typeRef.returnType);
				}),
				activeSignature: selectedFuncIndex,
				activeParameter: activeParameterIndex
			};
		}

		return { signatures: [] };
	}

	public getPrepareRenameInfo(fileUri: string, position: Position): { range: Range; placeholder: string } {
		const file = this.linker.getFileByUri(fileUri);
		if (!file) return null;

		const document = this.lsp.getDocument(fileUri);
		const index = document.positionToIndex(position);
		const token = this.tokens.find(token => token.fileIdentifier == file.identifier && token.start <= index && token.end >= index);
		if (!token) return null;

		return {
			range: {
				start: document.indexToPosition(token.start),
				end: document.indexToPosition(token.end)
			},
			placeholder: token.value
		};
	}

	public getRenameEdits(fileUri: string, position: Position, newName: string): WorkspaceEdit {
		const file = this.linker.getFileByUri(fileUri);
		if (!file) return null;

		const document = this.lsp.getDocument(fileUri);
		const index = document.positionToIndex(position);

		const { detail } = this.getTokenDetailAtIndex(file.identifier, index);
		const allMatchingDetails = this.compiler.getTokenDetailsMatchingRefId(detail.refId);

		const edits: { fileIdentifier: string; filePath: string; range: Range; newText: string }[] = [];
		allMatchingDetails.forEach(matchingDetail => {
			const defFile = this.linker.getFileByIdentifier(matchingDetail.token.fileIdentifier);
			const detailDocument = this.lsp.getDocument(defFile.filePath);

			edits.push({
				fileIdentifier: defFile.identifier,
				filePath: defFile.filePath,
				range: {
					start: detailDocument.indexToPosition(matchingDetail.token.start),
					end: detailDocument.indexToPosition(matchingDetail.token.end)
				},
				newText: newName
			});
		});

		const workspaceEdit: WorkspaceEdit = {
			changes: {}
		};

		edits.forEach(edit => {
			if (!workspaceEdit.changes[edit.filePath]) workspaceEdit.changes[edit.filePath] = [];
			workspaceEdit.changes[edit.filePath].push({
				range: edit.range,
				newText: edit.newText
			});
		});

		return workspaceEdit;
	}

	// Document symbols
	public getDocumentSymbols(fileUri: string): DocumentSymbol[] {
		const symbols: DocumentSymbol[] = [];
		const file = this.linker.getFileByUri(fileUri);
		if (!file) return [];

		const document = this.lsp.getDocument(fileUri);

		this.compiler.structs.forEach(struct => {
			if (struct.definition.location.fileIdentifier !== file.identifier) return;

			symbols.push(this.getSymbolOfStruct(document, struct));
		});

		this.compiler.functions.forEach(funcCtxArr => {
			funcCtxArr.forEach(funcCtx => {
				if (funcCtx.definition.location.fileIdentifier !== file.identifier) return;

				symbols.push(this.getSymbolOfFunction(document, funcCtx));
			});
		});

		return symbols;
	}

	private getSymbolOfFunction(document: Document, funcCtx: FunctionContext) {
		const symbol: DocumentSymbol = {
			name: funcCtx.nameToken.value,
			detail: funcCtx.getHoverDetail(),
			kind: funcCtx.methodForStruct != null ? SymbolKind.Method : SymbolKind.Function,
			range: {
				start: document.indexToPosition(funcCtx.definition.nameToken.start),
				end: document.indexToPosition(funcCtx.definition.bodyEndIndex)
			},
			selectionRange: {
				start: document.indexToPosition(funcCtx.definition.nameToken.start),
				end: document.indexToPosition(funcCtx.definition.nameToken.end)
			}
		};

		return symbol;
	}

	private getSymbolOfStruct(document: Document, struct: Struct) {
		const children: DocumentSymbol[] = [];

		struct.methods.forEach(methodList => {
			methodList.forEach(method => {
				children.push(this.getSymbolOfFunction(document, method));
			});
		});

		struct.fields.forEach((field, name) => {
			children.push({
				name: name,
				detail: Struct.getHoverDetailOfField(field),
				kind: SymbolKind.Property,
				range: {
					start: document.indexToPosition(field.nameToken.start),
					end: document.indexToPosition(field.nameToken.end)
				},
				selectionRange: {
					start: document.indexToPosition(field.nameToken.start),
					end: document.indexToPosition(field.nameToken.end)
				}
			});
		});

		const symbol: DocumentSymbol = {
			name: struct.nameToken.value,
			detail: struct.getHoverDetail(),
			kind: SymbolKind.Class,
			range: {
				start: document.indexToPosition(struct.nameToken.start),
				end: document.indexToPosition(struct.definition.bodyEndIndex)
			},
			selectionRange: {
				start: document.indexToPosition(struct.nameToken.start),
				end: document.indexToPosition(struct.nameToken.end)
			},
			children: children
		};

		return symbol;
	}

	// Inlay hints
	public getInlayHints(fileUri: string, range: Range): InlayHint[] {
		const targetFile = this.linker.getFileByUri(fileUri);
		if (!targetFile) return [];

		const document = this.lsp.getDocument(fileUri);

		const inlayHints: InlayHint[] = [];

		walk(targetFile.ast, node => {
			switch (node.type) {
				case ASTType.VariableDeclaration: {
					const hint = this.getVariableInlayHint(node, document);
					if (hint) inlayHints.push(hint);
					break;
				}

				case ASTType.FunctionDeclaration: {
					const hint = this.getFunctionInlayHint(node, document);
					if (hint) inlayHints.push(hint);
					break;
				}
			}
		});

		return inlayHints;
	}

	private getVariableInlayHint(varDecl: VariableDeclaration, document: Document): InlayHint {
		if (varDecl.variableType) return null;

		const detail = this.compiler.getTokenDetail(varDecl.nameToken);
		if (!detail) return null;

		return {
			position: document.indexToPosition(varDecl.nameToken.end),
			label: `: ${typeToStr(detail.typeRef)}`
		};
	}

	private getFunctionInlayHint(fnDecl: FunctionDeclaration, document: Document): InlayHint {
		if (fnDecl.returnType) return null;

		const fnDetail = this.compiler.getTokenDetail(fnDecl.nameToken);
		if (!fnDetail || !(fnDetail instanceof FunctionContext)) return null;

		return {
			position: document.indexToPosition(fnDetail.definition.closeParenToken.end),
			label: `: ${typeToStr(fnDetail.typeRef.returnType)}`
		};
	}

	// Semantic token types
	public getTokenTypeRanges(fileUri: string): TokenTypeRange[] {
		const targetFile = this.linker.getFileByUri(fileUri);
		if (!targetFile) return [];

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

		let errorCount = 0;
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

			errorCount++;
		};

		this.linker.getErrors().forEach(error => registerError(error));
		this.compiler.errors.forEach(error => registerError(error));

		return { errors, errorCount };
	}
}

export { Analyzer };
