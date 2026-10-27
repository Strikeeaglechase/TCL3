import path from "path";

import { ParserError, SourceSpan } from "../errors.js";
import { TypedObjectStream } from "../stream.js";
import {
	AddressOf,
	Assignment,
	AST,
	ASTNode,
	ASTType,
	ASTTypeRef,
	BinaryExpression,
	Block,
	BreakStatement,
	ContinueStatement,
	Dereference,
	EnumDeclaration,
	ForLoop,
	FunctionCall,
	FunctionDeclaration,
	FunctionTypeRef,
	IfStatement,
	Initializer,
	Literal,
	Program,
	Reference,
	ReturnStatement,
	Semicolon,
	StructDeclaration,
	StructFieldInitializer,
	TypeCast,
	UnaryExpression,
	VariableDeclaration,
	WhileLoop,
	WrappedTypeRef
} from "./ast.js";
import { mainFnName, operandPrecedence, selfAssignMathOps, Token, TokenType } from "./tokenizer.js";

const allowedOperatorOverloads = ["+", "-", "*", "/", "[]", "==", "!=", "<", ">", "<=", ">=", "&&", "||", "&", "|", "^", "<<", ">>"];
const builtinTypes = ["int", "char", "bool", "void"];
let id = 0;
class Parser {
	private tokenStream: TypedObjectStream<Token>;
	private rewrittenNames: Map<string, string> = new Map();
	private unitName: string;
	private enumRawNames: Set<string> = new Set();
	public parseErrors: ParserError[] = [];

	constructor(
		tokens: Token[],
		private publicSymbols: string[],
		private fileIdentifier: string,
		private throwOnError: boolean
	) {
		this.unitName = fileIdentifier + "_" + id++;

		// Remove comments and preprocessor directives as these are non-code tokens
		// They're returned from the tokenizer to allow for LSP features
		const readCodeTokens = tokens.filter(token => token.type != TokenType.PreprocessorDirective && token.type != TokenType.Comment);
		this.tokenStream = new TypedObjectStream(readCodeTokens);
	}

	public parse(): Program {
		const body: AST[] = [];

		while (!this.tokenStream.eof()) {
			const statement = this.parseStatement();
			if (statement) body.push(statement);
		}

		return { type: ASTType.Program, body: body };
	}

	private tokenSpan(token: Token): SourceSpan {
		return { startIndex: token.start, endIndex: token.end, fileIdentifier: this.fileIdentifier };
	}

	private spanFromStartingTokenIndex(startIndex: number): SourceSpan {
		const firstToken = this.tokenStream.data[startIndex];
		const lastToken = this.tokenStream.data[this.tokenStream.position - 1];

		return { startIndex: firstToken.start, endIndex: lastToken.end, fileIdentifier: this.fileIdentifier };
	}

	private spanFromStartingCharIndex(startIndex: number): SourceSpan {
		const lastToken = this.tokenStream.data[this.tokenStream.position - 1];
		return { startIndex: startIndex, endIndex: lastToken.end, fileIdentifier: this.fileIdentifier };
	}

	private extendedSpanFromNode(node: ASTNode): SourceSpan {
		if (!node.location) throw new Error(`Node has no location: ${JSON.stringify(node)}`);

		const endToken = this.tokenStream.data[this.tokenStream.position - 1];
		return { startIndex: node.location.startIndex, endIndex: endToken.end, fileIdentifier: this.fileIdentifier };
	}

	private attachLocation<T extends ASTNode>(node: T, startIndex: number): T {
		if (!node) return node;
		if (node.location) return node; // Don't overwrite existing location

		node.location = this.spanFromStartingTokenIndex(startIndex);
		return node;
	}

	private parseStatement(allowBinaryExpression = true): AST {
		const startIndex = this.tokenStream.position;
		try {
			const token = this.tokenStream.next();

			switch (token.type) {
				case TokenType.Keyword:
					return this.attachLocation(this.paresKeyword(token.value), startIndex);
				case TokenType.Identifier:
					return this.attachLocation(this.parseIdentifier(token.value, token, 0, allowBinaryExpression), startIndex);
				case TokenType.Operator:
					return this.attachLocation(this.parseOperator(token.value, allowBinaryExpression), startIndex);
				case TokenType.Symbol:
					return this.attachLocation(this.parseSymbol(token.value, allowBinaryExpression), startIndex);
				case TokenType.LiteralNumber:
				case TokenType.LiteralString:
				case TokenType.LiteralChar:
				case TokenType.LiteralBool:
					return this.attachLocation(this.parseLiteral(token, allowBinaryExpression), startIndex);

				default:
					throw new Error(`Unexpected token type: ${token.type}`);
			}
		} catch (e) {
			const parseError = new ParserError(e, this.spanFromStartingTokenIndex(startIndex));
			this.parseErrors.push(parseError);

			if (this.throwOnError) throw parseError;
		}
	}

	private paresKeyword(keyword: string) {
		switch (keyword) {
			case "fn":
				return this.handleFunctionDeclaration(false, false);
			case "let":
				return this.handleVariableDeclaration();
			case "struct":
				return this.handleStructDeclaration();
			case "return":
				return this.handleReturnStatement();
			case "out":
				return this.handleOutStatement();
			case "for":
				return this.handleForStatement();
			case "while":
				return this.handleWhileStatement();
			case "if":
				return this.handleIfStatement();
			case "enum":
				return this.handleEnumDeclaration();
			case "break":
				return this.handleBreakStatement();
			case "continue":
				return this.handleContinueStatement();
			default:
				throw new Error(`Unexpected keyword: ${keyword}`);
		}
	}

	private handleBreakStatement() {
		const breakStmt: BreakStatement = {
			type: ASTType.BreakStatement
		};

		return breakStmt;
	}

	private handleContinueStatement() {
		const continueStmt: ContinueStatement = {
			type: ASTType.ContinueStatement
		};

		return continueStmt;
	}

	private handleForStatement() {
		this.tokenStream.consumeTV(TokenType.Symbol, "(");
		const initializer = this.parseStatement();
		this.tokenStream.consumeTV(TokenType.Symbol, ";");
		const condition = this.parseStatement();
		this.tokenStream.consumeTV(TokenType.Symbol, ";");
		const increment = this.parseStatement();
		this.tokenStream.consumeTV(TokenType.Symbol, ")");

		const { body } = this.parseOptionallyBracketedBlock();

		const forLoop: ForLoop = {
			type: ASTType.ForLoop,
			initializer: initializer,
			condition: condition,
			increment: increment,
			body: body
		};

		return forLoop;
	}

	private handleWhileStatement() {
		this.tokenStream.consumeTV(TokenType.Symbol, "(");
		const condition = this.parseStatement();
		this.tokenStream.consumeTV(TokenType.Symbol, ")");
		const { body } = this.parseOptionallyBracketedBlock();

		const whileLoop: WhileLoop = {
			type: ASTType.WhileLoop,
			condition: condition,
			body: body
		};

		return whileLoop;
	}

	private handleIfStatement() {
		this.tokenStream.consumeTV(TokenType.Symbol, "(");
		const condition = this.parseStatement();
		this.tokenStream.consumeTV(TokenType.Symbol, ")");

		const { body: thenBody } = this.parseOptionallyBracketedBlock();
		const elifs: IfStatement["elseIfs"] = [];

		while (!this.tokenStream.eof()) {
			const peaked = this.tokenStream.peak();
			if (peaked.type != TokenType.Keyword || peaked.value != "elif") break;

			const start = this.tokenStream.position;
			this.tokenStream.consumeTV(TokenType.Keyword, "elif");
			this.tokenStream.consumeTV(TokenType.Symbol, "(");
			const elifCondition = this.parseStatement();
			this.tokenStream.consumeTV(TokenType.Symbol, ")");
			const { body: elifBody } = this.parseOptionallyBracketedBlock();

			elifs.push({ condition: elifCondition, body: elifBody, location: this.spanFromStartingTokenIndex(start) });
		}

		let elseBody: IfStatement["elseBody"] = null;
		const maybeElif = this.tokenStream.peak();
		if (maybeElif.type == TokenType.Keyword && maybeElif.value == "else") {
			const start = this.tokenStream.position;
			this.tokenStream.consumeTV(TokenType.Keyword, "else");
			const body = this.parseOptionallyBracketedBlock().body;
			const span = this.spanFromStartingTokenIndex(start);

			elseBody = { body: body, location: span };
		}

		const ifStmt: IfStatement = {
			type: ASTType.IfStatement,
			condition: condition,
			thenBody: thenBody,
			elseBody: elseBody,
			elseIfs: elifs
		};

		return ifStmt;
	}

	private handleReturnStatement() {
		const expression = this.parseStatement();
		const returnStmt: ReturnStatement = {
			type: ASTType.ReturnStatement,
			expression: expression
		};

		return returnStmt;
	}

	private handleOutStatement() {
		const expression = this.parseStatement();
		const outStmt: AST = {
			type: ASTType.Out,
			expression: expression
		};

		return outStmt;
	}

	private handleStructDeclaration() {
		const nameToken = this.tokenStream.consumeType(TokenType.Identifier);
		let name = nameToken.value;
		name = this.maybeRewriteName(name);
		this.tokenStream.consumeTV(TokenType.Symbol, "{");

		const fields: StructDeclaration["fields"] = [];
		const methods: FunctionDeclaration[] = [];
		while (!this.tokenStream.eof()) {
			const peaked = this.tokenStream.peak();
			if (peaked.type == TokenType.Symbol && peaked.value == "}") break;

			if (peaked.type == TokenType.Keyword && peaked.value == "fn") {
				this.tokenStream.consumeTV(TokenType.Keyword, "fn");
				const func = this.handleFunctionDeclaration(true, false);
				// Add this parameter
				func.parameters.unshift({
					name: "this",
					nameToken: { type: TokenType.Identifier, value: "this", start: -1, end: -1, fileIdentifier: this.fileIdentifier },
					type: this.createPointerTypeTo(name, nameToken),
					location: { startIndex: -1, endIndex: -1, fileIdentifier: this.fileIdentifier }
				});
				methods.push(func);
			} else if (peaked.type == TokenType.Keyword && peaked.value == "static") {
				this.tokenStream.consumeTV(TokenType.Keyword, "static");
				this.tokenStream.consumeTV(TokenType.Keyword, "fn");

				const func = this.handleFunctionDeclaration(true, true);
				methods.push(func);
			} else if (peaked.type == TokenType.Identifier) {
				const fieldName = this.tokenStream.consumeType(TokenType.Identifier);
				this.tokenStream.consumeTV(TokenType.Symbol, ":");
				const fieldType = this.parseTypeRef().type;
				this.tokenStream.consumeTV(TokenType.Symbol, ";");

				fields.push({ name: fieldName.value, nameToken: fieldName, type: fieldType, location: this.tokenSpan(fieldName) });
			} else {
				throw new Error(`Unexpected token in struct declaration: ${peaked.type} ${peaked.value}`);
			}
		}

		this.tokenStream.consumeTV(TokenType.Symbol, "}");

		const structDecl: StructDeclaration = {
			type: ASTType.StructDeclaration,
			name: name,
			nameToken: nameToken,
			fields: fields,
			methods: methods
		};

		return structDecl;
	}

	private handleEnumDeclaration() {
		const nameToken = this.tokenStream.consumeType(TokenType.Identifier);
		let name = nameToken.value;
		this.enumRawNames.add(name); // Add the enum name to the set of raw names
		name = this.maybeRewriteName(name);
		this.tokenStream.consumeTV(TokenType.Symbol, "{");

		const variants: EnumDeclaration["variants"] = [];

		let currentValue = 0;
		while (!this.tokenStream.maybeConsumeTV(TokenType.Symbol, "}")) {
			const variantNameToken = this.tokenStream.consumeType(TokenType.Identifier);
			const variantName = variantNameToken.value;
			let variantValue: number;

			if (this.tokenStream.maybeConsumeTV(TokenType.Symbol, ":")) {
				const valueToken = this.tokenStream.consumeType(TokenType.LiteralNumber);
				variantValue = parseInt(valueToken.value);
				currentValue = variantValue + 1; // Update currentValue for the next variant
			} else {
				variantValue = currentValue++;
			}

			variants.push({ name: variantName, value: variantValue, nameToken: variantNameToken, location: this.tokenSpan(variantNameToken) });

			this.tokenStream.maybeConsumeTV(TokenType.Symbol, ",");
		}

		const enumDecl: EnumDeclaration = {
			type: ASTType.EnumDeclaration,
			name: name,
			nameToken: nameToken,
			variants: variants
		};

		return enumDecl;
	}

	private createPointerTypeTo(raw: string, token: Token): WrappedTypeRef {
		return { type: ASTType.WrappedTypeRef, inner: { type: ASTType.RawTypeRef, rawType: raw, rawTypeToken: token } };
	}

	private handleFunctionDeclaration(structMethod: boolean, isStatic: boolean) {
		const startTokenIndex = this.tokenStream.position - 1; // The 'fn' token was already consumed
		const nameToken = this.tokenStream.next();
		let name = nameToken.value;
		// Operator overloaded function
		if (nameToken.type == TokenType.LiteralString) {
			const operator = nameToken.value;
			if (!allowedOperatorOverloads.includes(operator)) {
				throw new Error(`Operator ${operator} is not allowed to be overloaded`);
			}

			name = operator;
		} else if (nameToken.type != TokenType.Identifier) {
			throw new Error(`Unexpected token type for function name: ${nameToken.type}`);
		} else if (!structMethod) {
			name = this.maybeRewriteName(name);
		}

		const parameters = this.parseParenthesizedParameterList();
		let returnType: ASTTypeRef = null;
		if (this.tokenStream.maybeConsumeTV(TokenType.Symbol, ":")) {
			returnType = this.parseTypeRef().type;
		}

		let { body, bracketed } = this.parseOptionallyBracketedBlock();

		if (!bracketed) body = [{ type: ASTType.ReturnStatement, expression: body[0] }];

		const funcDecl: FunctionDeclaration = {
			type: ASTType.FunctionDeclaration,
			name: name,
			nameToken: nameToken,
			parameters: parameters,
			returnType: returnType,
			body: body,
			static: isStatic
		};

		return this.attachLocation(funcDecl, startTokenIndex);
	}

	private handleVariableDeclaration() {
		const nameToken = this.tokenStream.consumeType(TokenType.Identifier);
		const name = nameToken.value;
		let type: ASTTypeRef = null;
		let arrayInit: AST = null;

		if (this.tokenStream.maybeConsumeTV(TokenType.Symbol, ":")) {
			const typeResult = this.parseTypeRef();
			type = typeResult.type;
			arrayInit = typeResult.arrayInit;
		}

		this.tokenStream.consumeTV(TokenType.Symbol, "=");
		const initializer = this.parseStatement();

		const varDecl: VariableDeclaration = {
			type: ASTType.VariableDeclaration,
			name: name,
			nameToken: nameToken,
			variableType: type,
			initializer: initializer,
			arraySizeExpression: arrayInit
		};

		return varDecl;
	}

	private parseParenthesizedParameterList(): FunctionDeclaration["parameters"] {
		this.tokenStream.consumeTV(TokenType.Symbol, "(");
		const parameters: FunctionDeclaration["parameters"] = [];

		while (!this.tokenStream.eof()) {
			const peaked = this.tokenStream.peak();
			if (peaked.type == TokenType.Symbol && peaked.value == ")") break;

			if (parameters.length > 0) {
				this.tokenStream.consumeTV(TokenType.Symbol, ",");
			}

			const name = this.tokenStream.consumeType(TokenType.Identifier);
			this.tokenStream.consumeTV(TokenType.Symbol, ":");
			const type = this.parseTypeRef().type;

			parameters.push({ name: name.value, nameToken: name, type, location: this.tokenSpan(name) });
		}

		this.tokenStream.consumeTV(TokenType.Symbol, ")");

		return parameters;
	}

	private parseParenthesizedArgumentList(): AST[] {
		this.tokenStream.consumeTV(TokenType.Symbol, "(");
		const args: AST[] = [];
		while (!this.tokenStream.eof()) {
			const peaked = this.tokenStream.peak();
			if (peaked.type == TokenType.Symbol && peaked.value == ")") break;

			if (args.length > 0) {
				this.tokenStream.consumeTV(TokenType.Symbol, ",");
			}

			args.push(this.parseStatement(true));
		}

		this.tokenStream.consumeTV(TokenType.Symbol, ")");

		return args;
	}

	private parseOptionallyBracketedBlock(): { body: AST[]; bracketed: boolean } {
		const peaked = this.tokenStream.peak();
		const bracketed = peaked.type == TokenType.Symbol && peaked.value == "{";
		if (bracketed) {
			this.tokenStream.consumeTV(TokenType.Symbol, "{");
			const body: AST[] = [];
			while (!this.tokenStream.eof()) {
				const peaked = this.tokenStream.peak();
				if (peaked.type == TokenType.Symbol && peaked.value == "}") break;

				body.push(this.parseStatement());
			}

			this.tokenStream.consumeTV(TokenType.Symbol, "}");

			return { body, bracketed };
		} else {
			const body: AST[] = [this.parseStatement()];
			return { body, bracketed };
		}
	}

	private maybeRewriteName(name: string, createIfNeeded = true): string {
		if (this.publicSymbols.includes(name)) return name; // Don't rewrite exported symbols
		if (name == mainFnName) return name; // Don't rewrite main function
		if (this.rewrittenNames.has(name)) return this.rewrittenNames.get(name);
		if (name.startsWith("__")) return name;
		if (builtinTypes.includes(name)) return name;

		if (!createIfNeeded) return name;

		const newName = `__${this.unitName}_${name}`;
		this.rewrittenNames.set(name, newName);
		return newName;
	}

	private parseTypeRef(): { type: ASTTypeRef; arrayInit: AST | null } {
		const tokenStartIndex = this.tokenStream.position;
		const baseTypeToken = this.tokenStream.consumeType(TokenType.Identifier);
		const baseType = baseTypeToken.value;
		const rewrittenBaseType = this.maybeRewriteName(baseType);
		let currentType: ASTTypeRef = { type: ASTType.RawTypeRef, rawType: rewrittenBaseType, rawTypeToken: baseTypeToken };

		// Handle function type references
		if (baseType == "Fn") {
			this.tokenStream.consumeTV(TokenType.Operator, "<");
			const typeArgs: ASTTypeRef[] = [];

			while (!this.tokenStream.maybeConsumeTV(TokenType.Operator, ">")) {
				typeArgs.push(this.parseTypeRef().type);
				this.tokenStream.maybeConsumeTV(TokenType.Symbol, ",");
			}

			const returnType = typeArgs.pop();
			if (!returnType) throw new Error(`Function type must have a return type.`);

			const fnType: FunctionTypeRef = {
				type: ASTType.FunctionTypeRef,
				fnKeywordToken: baseTypeToken,
				parameters: typeArgs,
				returnType: returnType,
				location: this.spanFromStartingTokenIndex(tokenStartIndex)
			};

			currentType = fnType;
		}

		let arrayInit: AST | null = null;
		while (!this.tokenStream.eof()) {
			const peaked = this.tokenStream.peak();
			if (peaked.type == TokenType.Symbol && peaked.value == "[") {
				if (arrayInit != null) throw new Error(`Multi-dimensional array initialization not supported`);

				this.tokenStream.consumeTV(TokenType.Symbol, "[");
				arrayInit = this.parseStatement();
				this.tokenStream.consumeTV(TokenType.Symbol, "]");

				currentType = { type: ASTType.WrappedTypeRef, inner: currentType, location: this.spanFromStartingTokenIndex(tokenStartIndex) };
			} else if (peaked.type == TokenType.Operator && peaked.value == "*") {
				currentType = { type: ASTType.WrappedTypeRef, inner: currentType, location: this.spanFromStartingTokenIndex(tokenStartIndex) };
				this.tokenStream.consumeTV(TokenType.Operator, "*");
			} else {
				break;
			}
		}

		return { type: currentType, arrayInit: arrayInit };
	}

	private parseBinaryExpression(leftHand: AST, maxPrecedence = Number.POSITIVE_INFINITY): AST {
		while (!this.tokenStream.eof()) {
			const peaked = this.tokenStream.peak();
			if (peaked.type != TokenType.Operator) break;

			const opPrec = operandPrecedence[peaked.value];
			if (!opPrec) throw new Error(`Unknown operator: ${peaked.value}`);
			if (opPrec > maxPrecedence) break;

			const operator = this.tokenStream.consumeType(TokenType.Operator).value;
			let rightHand = this.parseStatement(false);
			rightHand = this.parseBinaryExpression(rightHand, opPrec - 1);

			leftHand = {
				type: ASTType.BinaryExpression,
				left: leftHand,
				operator: operator,
				right: rightHand,
				location: this.extendedSpanFromNode(leftHand)
			};
		}

		return leftHand;
	}

	private parseReference(firstIdent: string, firstIdentToken: Token, dereferenceCount: number) {
		// Only rewrite identifier if it already is a rewritten name
		// This means this reference is really a type of some sort
		// Either an enum ref, or a special built in function that accepts a type as an argument (like sizeof)
		firstIdent = this.maybeRewriteName(firstIdent, false);

		const topRef: Reference = {
			type: ASTType.Reference,
			identifier: firstIdent,
			identifierToken: firstIdentToken,
			offsetExpressions: null,
			child: null,
			dereferenceCount: dereferenceCount
		};

		let currentRef = topRef;

		// Currently handles three types of reference chaining:
		// 1. Simple struct field access: `myStruct.field`
		// 2. Array access: `myArray[5]`
		// 3. Dereference struct field access: `myStruct->field`
		while (!this.tokenStream.eof()) {
			const peaked = this.tokenStream.peak();
			// SImple concrete struct field access
			if (peaked.type == TokenType.Symbol && peaked.value == ".") {
				this.tokenStream.consumeTV(TokenType.Symbol, ".");
				const fieldIdent = this.tokenStream.consumeType(TokenType.Identifier);
				const childRef: Reference = {
					type: ASTType.Reference,
					identifier: fieldIdent.value,
					identifierToken: fieldIdent,
					offsetExpressions: null,
					child: null,
					dereferenceCount: 0
				};

				currentRef.child = childRef;
				currentRef = childRef;
			}
			// Array access, just update the current reference's offsetExpression
			else if (peaked.type == TokenType.Symbol && peaked.value == "[") {
				this.tokenStream.consumeTV(TokenType.Symbol, "[");
				const offsetExpr = this.parseStatement(true);
				this.tokenStream.consumeTV(TokenType.Symbol, "]");

				currentRef.offsetExpressions = [offsetExpr];

				// May be chained array accesses
				while (!this.tokenStream.eof()) {
					const nextPeaked = this.tokenStream.peak();
					if (nextPeaked.type != TokenType.Symbol || nextPeaked.value != "[") break;
					this.tokenStream.consumeTV(TokenType.Symbol, "[");
					const nextOffsetExpr = this.parseStatement(true);
					this.tokenStream.consumeTV(TokenType.Symbol, "]");

					currentRef.offsetExpressions.push(nextOffsetExpr);
				}
			}
			// Dereference struct field access
			else if (peaked.type == TokenType.Symbol && peaked.value == "->") {
				this.tokenStream.consumeTV(TokenType.Symbol, "->");
				const fieldIdent = this.tokenStream.consumeType(TokenType.Identifier);
				const childRef: Reference = {
					type: ASTType.Reference,
					identifier: fieldIdent.value,
					identifierToken: fieldIdent,
					offsetExpressions: null,
					child: null,
					dereferenceCount: 0
				};

				currentRef.child = childRef;
				currentRef.dereferenceCount = 1;
				currentRef = childRef;
			} else {
				break;
			}
		}

		topRef.location = this.spanFromStartingCharIndex(firstIdentToken.start);

		return topRef;
	}

	private parseIdentifier(ident: string, identToken: Token, dereferenceCount: number, allowBinaryExpression = true): AST {
		// Struct field initializer, doesn't use a reference as 'deep-assignments' are not supported
		if (this.tokenStream.maybeConsumeTV(TokenType.Symbol, ":")) {
			const expression = this.parseStatement();
			const structFieldInit: StructFieldInitializer = {
				type: ASTType.StructFieldInitializer,
				name: ident,
				nameToken: identToken,
				expression: expression
			};

			return structFieldInit;
		}

		const ref = this.parseReference(ident, identToken, dereferenceCount);
		return this.handleReference(ref, allowBinaryExpression);
	}

	private handleSelfAssignMathOp(ref: Reference) {
		const operatorToken = this.tokenStream.consumeType(TokenType.Symbol);
		const operator = operatorToken.value.slice(0, -1); // Remove the '=' from the operator
		const expression = this.parseStatement();

		const binaryExpr: BinaryExpression = {
			type: ASTType.BinaryExpression,
			left: ref,
			operator: operator,
			right: expression,
			location: this.extendedSpanFromNode(ref)
		};

		const assignment: Assignment = {
			type: ASTType.VariableAssignment,
			reference: ref,
			expression: binaryExpr,
			location: this.extendedSpanFromNode(ref)
		};

		return assignment;
	}

	private handleReference(ref: Reference, allowBinaryExpression: boolean) {
		const peaked = this.tokenStream.peak();
		if (peaked.type == TokenType.Symbol && peaked.value == "(") return this.handleFunctionCall(ref, allowBinaryExpression);
		if (peaked.type == TokenType.Symbol && peaked.value == "=") return this.handleVariableAssignment(ref);
		if (peaked.type == TokenType.Symbol && selfAssignMathOps.includes(peaked.value)) return this.handleSelfAssignMathOp(ref);
		if (allowBinaryExpression && peaked.type == TokenType.Operator) return this.parseBinaryExpression(ref);
		return ref;
	}

	private handleVariableAssignment(ref: Reference) {
		this.tokenStream.consumeTV(TokenType.Symbol, "=");
		const expression = this.parseStatement();
		const assignment: Assignment = {
			type: ASTType.VariableAssignment,
			reference: ref,
			expression: expression
		};

		return assignment;
	}

	private handleFunctionCall(ref: Reference, allowBinaryExpression: boolean) {
		if (!ref.child && this.rewrittenNames.has(ref.identifier)) {
			ref.identifier = this.rewrittenNames.get(ref.identifier); // Rewrite function name if it was rewritten
		}

		const args = this.parseParenthesizedArgumentList();
		const call: FunctionCall = {
			type: ASTType.FunctionCall,
			reference: ref,
			arguments: args
		};

		const peaked = this.tokenStream.peak();
		// Handle chained reference
		// Is handled using a temporary local variable to store the return
		const isAccessBeyond = peaked.type == TokenType.Symbol && (peaked.value == "." || peaked.value == "[" || peaked.value == "->");
		const isBinaryBeyond = peaked.type == TokenType.Operator && operandPrecedence[peaked.value] > 0;
		if (isAccessBeyond || isBinaryBeyond) {
			const tempVarName = `__func_ret_temp_${id++}`;
			const tempVarDecl: VariableDeclaration = {
				type: ASTType.VariableDeclaration,
				name: tempVarName,
				nameToken: { type: TokenType.Identifier, value: tempVarName, start: -1, end: -1, fileIdentifier: this.fileIdentifier },
				variableType: null, // Infer type
				initializer: call,
				arraySizeExpression: null
			};

			const remainingRef = this.parseIdentifier(tempVarName, tempVarDecl.nameToken, 0, allowBinaryExpression);
			const block: Block = {
				type: ASTType.Block,
				body: [tempVarDecl, remainingRef]
			};

			const peakedBeyond = this.tokenStream.peak();
			const peakedBeyondIsBinary = peakedBeyond.type == TokenType.Operator && operandPrecedence[peakedBeyond.value] > 0;
			if (allowBinaryExpression && (peakedBeyondIsBinary || isBinaryBeyond)) {
				return this.parseBinaryExpression(block);
			}

			return block;
		}

		return call;
	}

	private parseOperator(op: string, allowBinaryExpression: boolean): AST {
		const startTokenIndex = this.tokenStream.position - 1; // The operator token has already been consumed
		switch (op) {
			case "&": {
				const ref = this.parseStatement(false);
				if (ref.type != ASTType.Reference) throw new Error(`Cannot take address of non-reference type`);
				const addrOf: AddressOf = this.attachLocation({ type: ASTType.AddressOf, reference: ref }, startTokenIndex);
				return this.maybeStartBinaryExpressionOrBlockedReference(addrOf, allowBinaryExpression);
			}
			case "*": {
				let count = 1;
				while (this.tokenStream.maybeConsumeTV(TokenType.Operator, "*")) count++;
				const peaked = this.tokenStream.peak();
				let dereference: AST;
				if (peaked.type == TokenType.Identifier) {
					const identToken = this.tokenStream.consumeType(TokenType.Identifier);
					dereference = this.parseIdentifier(identToken.value, identToken, count, false);
				} else {
					dereference = {
						type: ASTType.Dereference,
						operand: this.parseStatement(false),
						dereferenceCount: count
					};
				}

				this.attachLocation(dereference, startTokenIndex);
				return this.maybeStartBinaryExpressionOrBlockedReference(dereference, allowBinaryExpression);
			}
			case "!":
			case "-":
			case "~": {
				const operand = this.parseStatement(false);
				const unaryExpr: UnaryExpression = {
					type: ASTType.UnaryExpression,
					operator: op,
					operand: operand,
					location: this.spanFromStartingTokenIndex(startTokenIndex)
				};
				return this.maybeStartBinaryExpressionOrBlockedReference(unaryExpr, allowBinaryExpression);
			}
			// case ""
			default:
				throw new Error(`Unexpected operator: ${op}`);
		}
	}

	private parseInitializer() {
		const values: AST[] = [];
		while (!this.tokenStream.eof()) {
			const peaked = this.tokenStream.peak();
			if (peaked.type == TokenType.Symbol && peaked.value == "}") break;

			if (values.length > 0) this.tokenStream.consumeTV(TokenType.Symbol, ",");
			values.push(this.parseStatement(true));
		}

		this.tokenStream.consumeTV(TokenType.Symbol, "}");

		const init: Initializer = {
			type: ASTType.Initializer,
			values: values
		};

		return init;
	}

	private maybeStartBinaryExpressionOrBlockedReference(ast: AST, allowBinaryExpression: boolean): AST {
		const peaked = this.tokenStream.peak();
		if (!peaked) return ast;
		if (allowBinaryExpression && peaked.type == TokenType.Operator) return this.parseBinaryExpression(ast);

		if (peaked.type == TokenType.Symbol && (peaked.value == "." || peaked.value == "[" || peaked.value == "->")) {
			const tempVarName = `__func_ret_temp_${id++}`;
			const tempVarDecl: VariableDeclaration = {
				type: ASTType.VariableDeclaration,
				name: tempVarName,
				nameToken: { type: TokenType.Identifier, value: tempVarName, start: -1, end: -1, fileIdentifier: this.fileIdentifier },
				variableType: null, // Infer type
				initializer: ast,
				arraySizeExpression: null
			};

			const remainingRef = this.parseIdentifier(tempVarName, tempVarDecl.nameToken, 0, allowBinaryExpression);
			const block: Block = {
				type: ASTType.Block,
				body: [tempVarDecl, remainingRef]
			};

			return this.maybeStartBinaryExpressionOrBlockedReference(block, allowBinaryExpression);
		}

		return ast;
	}

	private parseSymbol(symbol: string, allowBinaryExpression: boolean) {
		const startTokenIndex = this.tokenStream.position - 1; // The symbol token has already been consumed
		switch (symbol) {
			case ";":
				const semi: Semicolon = { type: ASTType.Semicolon };
				return semi;
			case "{":
				return this.parseInitializer();
			case "(":
				const inner = this.parseStatement(true);
				this.tokenStream.consumeTV(TokenType.Symbol, ")");
				return this.maybeStartBinaryExpressionOrBlockedReference(inner, allowBinaryExpression);
			case "▸":
				const innerType = this.parseTypeRef();
				this.tokenStream.consumeTV(TokenType.Symbol, "◂");
				const innerExpr = this.parseStatement();
				const cast: TypeCast = {
					type: ASTType.TypeCast,
					castType: innerType.type,
					expression: innerExpr,
					location: this.spanFromStartingTokenIndex(startTokenIndex)
				};

				return cast;
			default:
				throw new Error(`Unexpected symbol: ${symbol}`);
		}
	}

	private parseLiteral(literal: Token, allowBinaryExpression: boolean) {
		const lit: Literal = {
			type: ASTType.Literal,
			value: literal.value,
			literalType: literal.type,
			location: this.tokenSpan(literal)
		};

		return this.maybeStartBinaryExpressionOrBlockedReference(lit, allowBinaryExpression);
	}
}

export { Parser };
