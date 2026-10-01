import { TypedObjectStream } from "../stream.js";
import {
	Assignment,
	AST,
	ASTType,
	ASTTypeRef,
	BinaryExpression,
	FunctionCall,
	FunctionDeclaration,
	Initializer,
	Literal,
	Program,
	Reference,
	ReturnStatement,
	Semicolon,
	StructDeclaration,
	StructFieldInitializer,
	VariableDeclaration,
	WrappedTypeRef
} from "./ast.js";
import { operandPrecedence, Token, TokenType } from "./tokenizer.js";

const allowedOperatorOverloads = "+-*/[";
const builtinTypes = ["int", "char", "bool", "void"];

class Parser {
	private tokenStream: TypedObjectStream<Token>;
	private rewrittenNames: Map<string, string> = new Map();
	private unitName: string;

	constructor(
		tokens: Token[],
		private publicSymbols: string[],
		unitName?: string
	) {
		this.unitName =
			unitName ??
			Math.floor(Math.random() * 1e9)
				.toString(16)
				.padStart(8, "0");

		this.tokenStream = new TypedObjectStream(tokens);
	}

	public parse(): Program {
		const body: AST[] = [];

		while (!this.tokenStream.eof()) {
			body.push(this.parseStatement());
		}

		return { type: ASTType.Program, body: body };
	}

	private parseStatement(): AST {
		const token = this.tokenStream.next();

		switch (token.type) {
			case TokenType.Keyword:
				return this.paresKeyword(token.value);
			case TokenType.Identifier:
				return this.parseIdentifier(token.value);
			case TokenType.Operator:
				return this.parseOperator(token.value);
			case TokenType.Symbol:
				return this.parseSymbol(token.value);
			case TokenType.LiteralNumber:
			case TokenType.LiteralString:
				return this.parseLiteral(token);
			default:
				throw new Error(`Unexpected token type: ${token.type}`);
		}
	}

	private paresKeyword(keyword: string) {
		switch (keyword) {
			case "fn":
				return this.handleFunctionDeclaration(false);
			case "let":
				return this.handleVariableDeclaration();
			case "struct":
				return this.handleStructDeclaration();
			case "return":
				return this.handleReturnStatement();
			case "out":
				return this.handleOutStatement();
			default:
				throw new Error(`Unexpected keyword: ${keyword}`);
		}
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
		let name = this.tokenStream.consumeType(TokenType.Identifier).value;
		name = this.maybeRewriteName(name);
		this.tokenStream.consumeTV(TokenType.Symbol, "{");

		const fields: { name: string; type: ASTTypeRef }[] = [];
		const methods: FunctionDeclaration[] = [];
		while (!this.tokenStream.eof()) {
			const peaked = this.tokenStream.peak();
			if (peaked.type == TokenType.Symbol && peaked.value == "}") break;

			if (peaked.type == TokenType.Keyword && peaked.value == "fn") {
				this.tokenStream.consumeTV(TokenType.Keyword, "fn");
				const func = this.handleFunctionDeclaration(true);
				func.parameters.unshift({ name: "this", type: this.createPointerTypeTo(name) }); // Add this parameter
				methods.push(func);
			} else if (peaked.type == TokenType.Identifier) {
				const fieldName = this.tokenStream.consumeType(TokenType.Identifier).value;
				this.tokenStream.consumeTV(TokenType.Symbol, ":");
				const fieldType = this.parseTypeRef().type;
				this.tokenStream.consumeTV(TokenType.Symbol, ";");

				fields.push({ name: fieldName, type: fieldType });
			} else {
				throw new Error(`Unexpected token in struct declaration: ${peaked.type} ${peaked.value}`);
			}
		}

		this.tokenStream.consumeTV(TokenType.Symbol, "}");

		const structDecl: StructDeclaration = {
			type: ASTType.StructDeclaration,
			name: name,
			fields: fields,
			methods: methods
		};

		return structDecl;
	}

	private createPointerTypeTo(raw: string): WrappedTypeRef {
		return { type: ASTType.WrappedTypeRef, inner: { type: ASTType.RawTypeRef, rawType: raw } };
	}

	private handleFunctionDeclaration(structMethod: boolean) {
		const nameToken = this.tokenStream.next();
		let name = nameToken.value;
		// Operator overloaded function
		if (nameToken.type == TokenType.LiteralNumber) {
			const operator = String.fromCharCode(parseInt(nameToken.value));
			if (!allowedOperatorOverloads.includes(operator)) {
				throw new Error(`Operator ${operator} is not allowed to be overloaded`);
			}

			name = operator;
		} else if (!structMethod) {
			name = this.maybeRewriteName(name);
		}

		const parameters = this.parseParenthesizedParameterList();
		this.tokenStream.consumeTV(TokenType.Symbol, ":");

		const returnType = this.parseTypeRef().type;
		let { body, bracketed } = this.parseOptionallyBracketedBlock();

		if (!bracketed) body = [{ type: ASTType.ReturnStatement, expression: body[0] }];

		const funcDecl: FunctionDeclaration = {
			type: ASTType.FunctionDeclaration,
			name: name,
			parameters: parameters,
			returnType: returnType,
			body: body
		};

		return funcDecl;
	}

	private handleVariableDeclaration() {
		const name = this.tokenStream.consumeType(TokenType.Identifier).value;
		this.tokenStream.consumeTV(TokenType.Symbol, ":");
		const { type, arrayInit } = this.parseTypeRef();
		this.tokenStream.consumeTV(TokenType.Symbol, "=");
		const initializer = this.parseStatement();

		const varDecl: VariableDeclaration = {
			type: ASTType.VariableDeclaration,
			name: name,
			variableType: type,
			initializer: initializer,
			arraySizeExpression: arrayInit
		};

		return varDecl;
	}

	private parseParenthesizedParameterList(): { name: string; type: ASTTypeRef }[] {
		this.tokenStream.consumeTV(TokenType.Symbol, "(");
		const parameters: { name: string; type: ASTTypeRef }[] = [];

		while (!this.tokenStream.eof()) {
			const peaked = this.tokenStream.peak();
			if (peaked.type == TokenType.Symbol && peaked.value == ")") break;

			if (parameters.length > 0) {
				this.tokenStream.consumeTV(TokenType.Symbol, ",");
			}

			const name = this.tokenStream.consumeType(TokenType.Identifier).value;
			this.tokenStream.consumeTV(TokenType.Symbol, ":");
			const type = this.parseTypeRef().type;

			parameters.push({ name, type });
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

			args.push(this.parseStatement());
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

	private maybeRewriteName(name: string): string {
		if (this.publicSymbols.includes(name)) return name; // Don't rewrite exported symbols
		if (this.rewrittenNames.has(name)) return this.rewrittenNames.get(name);
		if (name.startsWith("__")) return name;
		if (builtinTypes.includes(name)) return name;

		const newName = `__${this.unitName}_${name}`;
		this.rewrittenNames.set(name, newName);
		return newName;
	}

	private parseTypeRef(): { type: ASTTypeRef; arrayInit: AST | null } {
		const baseType = this.tokenStream.consumeType(TokenType.Identifier).value;
		const rewrittenBaseType = this.maybeRewriteName(baseType);
		let currentType: ASTTypeRef = { type: ASTType.RawTypeRef, rawType: rewrittenBaseType };
		let arrayInit: AST | null = null;
		while (!this.tokenStream.eof()) {
			const peaked = this.tokenStream.peak();
			if (peaked.type == TokenType.Symbol && peaked.value == "[") {
				if (arrayInit != null) throw new Error(`Multi-dimensional array initialization not supported`);

				this.tokenStream.consumeTV(TokenType.Symbol, "[");
				arrayInit = this.parseStatement();
				this.tokenStream.consumeTV(TokenType.Symbol, "]");

				currentType = { type: ASTType.WrappedTypeRef, inner: currentType };
			} else if (peaked.type == TokenType.Operator && peaked.value == "*") {
				currentType = { type: ASTType.WrappedTypeRef, inner: currentType };
				this.tokenStream.consumeTV(TokenType.Operator, "*");
			} else {
				break;
			}
		}

		return { type: currentType, arrayInit: arrayInit };
	}

	private parseBinaryExpression(leftHand: AST, prec = 0): AST {
		const peaked = this.tokenStream.peak();
		if (peaked.type != TokenType.Operator) return leftHand;

		const operator = this.tokenStream.consumeType(TokenType.Operator).value;
		const opPrec = operandPrecedence[operator];
		if (!opPrec) throw new Error(`Unknown operator: ${operator}`);

		if (opPrec > prec) {
			const rightHand = this.parseBinaryExpression(this.parseStatement(), opPrec);
			const binaryExpr: BinaryExpression = {
				type: ASTType.BinaryExpression,
				left: leftHand,
				operator: operator,
				right: rightHand
			};

			return this.parseBinaryExpression(binaryExpr, prec);
		}

		return leftHand;
	}

	private parseReference(firstIdent: string) {
		const topRef: Reference = {
			type: ASTType.Reference,
			identifier: firstIdent,
			offsetExpressions: null,
			child: null,
			dereferenceForChild: false
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
				const fieldIdent = this.tokenStream.consumeType(TokenType.Identifier).value;
				const childRef: Reference = {
					type: ASTType.Reference,
					identifier: fieldIdent,
					offsetExpressions: null,
					child: null,
					dereferenceForChild: false
				};

				currentRef.child = childRef;
				currentRef = childRef;
			}
			// Array access, just update the current reference's offsetExpression
			else if (peaked.type == TokenType.Symbol && peaked.value == "[") {
				this.tokenStream.consumeTV(TokenType.Symbol, "[");
				const offsetExpr = this.parseStatement();
				this.tokenStream.consumeTV(TokenType.Symbol, "]");

				currentRef.offsetExpressions = [offsetExpr];

				// May be chained array accesses
				while (!this.tokenStream.eof()) {
					const nextPeaked = this.tokenStream.peak();
					if (nextPeaked.type != TokenType.Symbol || nextPeaked.value != "[") break;
					this.tokenStream.consumeTV(TokenType.Symbol, "[");
					const nextOffsetExpr = this.parseStatement();
					this.tokenStream.consumeTV(TokenType.Symbol, "]");

					currentRef.offsetExpressions.push(nextOffsetExpr);
				}
			}
			// Dereference struct field access
			else if (peaked.type == TokenType.Symbol && peaked.value == "->") {
				this.tokenStream.consumeTV(TokenType.Symbol, "->");
				const fieldIdent = this.tokenStream.consumeType(TokenType.Identifier).value;
				const childRef: Reference = {
					type: ASTType.Reference,
					identifier: fieldIdent,
					offsetExpressions: null,
					child: null,
					dereferenceForChild: false
				};

				currentRef.child = childRef;
				currentRef.dereferenceForChild = true;
				currentRef = childRef;
			} else {
				break;
			}
		}

		return topRef;
	}

	private parseIdentifier(ident: string) {
		// Struct field initializer, doesn't use a reference as 'deep-assignments' are not supported
		const peaked = this.tokenStream.peak();
		if (peaked.type == TokenType.Symbol && peaked.value == ":") {
			this.tokenStream.consumeTV(TokenType.Symbol, ":");
			const expression = this.parseStatement();
			const structFieldInit: StructFieldInitializer = {
				type: ASTType.StructFieldInitializer,
				name: ident,
				expression: expression
			};

			return structFieldInit;
		}

		const ref = this.parseReference(ident);
		return this.handleReference(ref);
	}

	private handleReference(ref: Reference) {
		const peaked = this.tokenStream.peak();
		if (peaked.type == TokenType.Symbol && peaked.value == "(") return this.handleFunctionCall(ref);
		if (peaked.type == TokenType.Symbol && peaked.value == "=") return this.handleVariableAssignment(ref);
		if (peaked.type == TokenType.Operator) return this.parseBinaryExpression(ref);
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

	private handleFunctionCall(ref: Reference) {
		if (!ref.child && this.rewrittenNames.has(ref.identifier)) {
			ref.identifier = this.rewrittenNames.get(ref.identifier); // Rewrite function name if it was rewritten
		}

		const args = this.parseParenthesizedArgumentList();
		const call: FunctionCall = {
			type: ASTType.FunctionCall,
			reference: ref,
			arguments: args
		};

		return call;
	}

	private parseOperator(op: string): AST {
		switch (op) {
			case "&":
				const ref = this.parseStatement();
				if (ref.type != ASTType.Reference) throw new Error(`Cannot take address of non-reference type`);
				return { type: ASTType.AddressOf, reference: ref };
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
			values.push(this.parseStatement());
		}

		this.tokenStream.consumeTV(TokenType.Symbol, "}");

		const init: Initializer = {
			type: ASTType.Initializer,
			values: values
		};

		return init;
	}

	private parseSymbol(symbol: string) {
		switch (symbol) {
			case ";":
				const semi: Semicolon = { type: ASTType.Semicolon };
				return semi;
			case "{":
				return this.parseInitializer();
			default:
				throw new Error(`Unexpected symbol: ${symbol}`);
		}
	}

	private parseLiteral(literal: Token) {
		const lit: Literal = {
			type: ASTType.Literal,
			value: literal.value,
			literalType: literal.type == TokenType.LiteralNumber ? "number" : "string"
		};

		return lit;
	}
}

export { Parser };
