import { TypedObjectStream } from "../stream.js";
import {
	AddressOf,
	Assignment,
	AST,
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
	UnaryExpression,
	VariableDeclaration,
	WhileLoop,
	WrappedTypeRef
} from "./ast.js";
import { operandPrecedence, Token, TokenType } from "./tokenizer.js";

const allowedOperatorOverloads = ["+", "-", "*", "/", "[", "==", "!=", "<", ">", "<=", ">=", "&&", "||", "&", "|", "^", "<<", ">>"];
const builtinTypes = ["int", "char", "bool", "void"];

let id = 0;
class Parser {
	private tokenStream: TypedObjectStream<Token>;
	private rewrittenNames: Map<string, string> = new Map();
	private unitName: string;
	private enumRawNames: Set<string> = new Set();

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
				return this.parseIdentifier(token.value, 0);
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
		const elifs: { condition: AST; body: AST[] }[] = [];

		while (!this.tokenStream.eof()) {
			const peaked = this.tokenStream.peak();
			if (peaked.type != TokenType.Keyword || peaked.value != "elif") break;

			this.tokenStream.consumeTV(TokenType.Keyword, "elif");
			this.tokenStream.consumeTV(TokenType.Symbol, "(");
			const elifCondition = this.parseStatement();
			this.tokenStream.consumeTV(TokenType.Symbol, ")");
			const { body: elifBody } = this.parseOptionallyBracketedBlock();

			elifs.push({ condition: elifCondition, body: elifBody });
		}

		let elseBody: AST[] | null = null;
		const maybeElif = this.tokenStream.peak();
		if (maybeElif.type == TokenType.Keyword && maybeElif.value == "else") {
			this.tokenStream.consumeTV(TokenType.Keyword, "else");
			elseBody = this.parseOptionallyBracketedBlock().body;
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
				const func = this.handleFunctionDeclaration(true, false);
				func.parameters.unshift({ name: "this", type: this.createPointerTypeTo(name) }); // Add this parameter
				methods.push(func);
			} else if (peaked.type == TokenType.Keyword && peaked.value == "static") {
				this.tokenStream.consumeTV(TokenType.Keyword, "static");
				this.tokenStream.consumeTV(TokenType.Keyword, "fn");

				const func = this.handleFunctionDeclaration(true, true);
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

	private handleEnumDeclaration() {
		let name = this.tokenStream.consumeType(TokenType.Identifier).value;
		this.enumRawNames.add(name); // Add the enum name to the set of raw names
		name = this.maybeRewriteName(name);
		this.tokenStream.consumeTV(TokenType.Symbol, "{");

		const variants: { name: string; value: number }[] = [];

		let currentValue = 0;
		while (!this.tokenStream.maybeConsumeTV(TokenType.Symbol, "}")) {
			const variantName = this.tokenStream.consumeType(TokenType.Identifier).value;
			let variantValue: number;

			if (this.tokenStream.maybeConsumeTV(TokenType.Symbol, ":")) {
				const valueToken = this.tokenStream.consumeType(TokenType.LiteralNumber);
				variantValue = parseInt(valueToken.value);
			} else {
				variantValue = currentValue++;
			}

			variants.push({ name: variantName, value: variantValue });

			this.tokenStream.maybeConsumeTV(TokenType.Symbol, ",");
		}

		const enumDecl: EnumDeclaration = {
			type: ASTType.EnumDeclaration,
			name: name,
			variants: variants
		};

		return enumDecl;
	}

	private createPointerTypeTo(raw: string): WrappedTypeRef {
		return { type: ASTType.WrappedTypeRef, inner: { type: ASTType.RawTypeRef, rawType: raw } };
	}

	private handleFunctionDeclaration(structMethod: boolean, isStatic: boolean) {
		const nameToken = this.tokenStream.next();
		let name = nameToken.value;
		// Operator overloaded function
		if (nameToken.type == TokenType.LiteralString) {
			const operator = nameToken.value.slice(1, -1); // Remove the quotes from the operator string
			if (!allowedOperatorOverloads.includes(operator)) {
				throw new Error(`Operator ${operator} is not allowed to be overloaded`);
			}

			name = operator;
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
			parameters: parameters,
			returnType: returnType,
			body: body,
			static: isStatic
		};

		return funcDecl;
	}

	private handleVariableDeclaration() {
		const name = this.tokenStream.consumeType(TokenType.Identifier).value;
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

	private maybeRewriteName(name: string, createIfNeeded = true): string {
		if (this.publicSymbols.includes(name)) return name; // Don't rewrite exported symbols
		if (this.rewrittenNames.has(name)) return this.rewrittenNames.get(name);
		if (name.startsWith("__")) return name;
		if (builtinTypes.includes(name)) return name;

		if (!createIfNeeded) return name;

		const newName = `__${this.unitName}_${name}`;
		this.rewrittenNames.set(name, newName);
		return newName;
	}

	private parseTypeRef(): { type: ASTTypeRef; arrayInit: AST | null } {
		const baseType = this.tokenStream.consumeType(TokenType.Identifier).value;
		const rewrittenBaseType = this.maybeRewriteName(baseType);
		let currentType: ASTTypeRef = { type: ASTType.RawTypeRef, rawType: rewrittenBaseType };

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
				parameters: typeArgs,
				returnType: returnType
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

	private parseReference(firstIdent: string, dereferenceCount: number) {
		// Only rewrite identifier if it already is a rewritten name
		// This means this reference is really a type of some sort
		// Either an enum ref, or a special built in function that accepts a type as an argument (like sizeof)
		firstIdent = this.maybeRewriteName(firstIdent, false);

		const topRef: Reference = {
			type: ASTType.Reference,
			identifier: firstIdent,
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
				const fieldIdent = this.tokenStream.consumeType(TokenType.Identifier).value;
				const childRef: Reference = {
					type: ASTType.Reference,
					identifier: fieldIdent,
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
					dereferenceCount: 0
				};

				currentRef.child = childRef;
				currentRef.dereferenceCount = 1;
				currentRef = childRef;
			} else {
				break;
			}
		}

		return topRef;
	}

	private parseIdentifier(ident: string, dereferenceCount: number): AST {
		// Struct field initializer, doesn't use a reference as 'deep-assignments' are not supported
		if (this.tokenStream.maybeConsumeTV(TokenType.Symbol, ":")) {
			const expression = this.parseStatement();
			const structFieldInit: StructFieldInitializer = {
				type: ASTType.StructFieldInitializer,
				name: ident,
				expression: expression
			};

			return structFieldInit;
		}

		const ref = this.parseReference(ident, dereferenceCount);
		return this.handleReference(ref);
	}

	private handleSelfAssignMathOp(ref: Reference) {
		const operatorToken = this.tokenStream.consumeType(TokenType.Symbol);
		const operator = operatorToken.value.slice(0, -1); // Remove the '=' from the operator
		const expression = this.parseStatement();

		const binaryExpr: BinaryExpression = {
			type: ASTType.BinaryExpression,
			left: ref,
			operator: operator,
			right: expression
		};

		const assignment: Assignment = {
			type: ASTType.VariableAssignment,
			reference: ref,
			expression: binaryExpr
		};

		return assignment;
	}

	private handleReference(ref: Reference) {
		const peaked = this.tokenStream.peak();
		if (peaked.type == TokenType.Symbol && peaked.value == "(") return this.handleFunctionCall(ref);
		if (peaked.type == TokenType.Symbol && peaked.value == "=") return this.handleVariableAssignment(ref);
		const selfAssignMathOps = ["+=", "-=", "*=", "/=", "%="];
		if (peaked.type == TokenType.Symbol && selfAssignMathOps.includes(peaked.value)) return this.handleSelfAssignMathOp(ref);
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
				variableType: null, // Infer type
				initializer: call,
				arraySizeExpression: null
			};

			const remainingRef = this.parseIdentifier(tempVarName, 0);
			const block: Block = {
				type: ASTType.Block,
				body: [tempVarDecl, remainingRef]
			};

			const peakedBeyond = this.tokenStream.peak();
			const peakedBeyondIsBinary = peakedBeyond.type == TokenType.Operator && operandPrecedence[peakedBeyond.value] > 0;
			if (peakedBeyondIsBinary || isBinaryBeyond) {
				return this.parseBinaryExpression(block);
			}

			return block;
		}

		return call;
	}

	private parseOperator(op: string): AST {
		switch (op) {
			case "&":
				const ref = this.parseStatement();
				if (ref.type != ASTType.Reference) throw new Error(`Cannot take address of non-reference type`);
				const addrOf: AddressOf = { type: ASTType.AddressOf, reference: ref };
				return addrOf;
			case "*":
				let count = 1;
				while (this.tokenStream.maybeConsumeTV(TokenType.Operator, "*")) count++;
				const peaked = this.tokenStream.peak();
				if (peaked.type == TokenType.Identifier) {
					return this.parseIdentifier(this.tokenStream.consumeType(TokenType.Identifier).value, count);
				} else {
					const deref: Dereference = {
						type: ASTType.Dereference,
						operand: this.parseStatement(),
						dereferenceCount: count
					};

					return deref;
				}
			case "!":
			case "-":
			case "~":
				const operand = this.parseStatement();
				const unaryExpr: UnaryExpression = {
					type: ASTType.UnaryExpression,
					operator: op,
					operand: operand
				};
				return unaryExpr;
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

	private maybeStartBinaryExpressionOrBlockedReference(ast: AST): AST {
		const peaked = this.tokenStream.peak();
		if (peaked.type == TokenType.Operator) return this.parseBinaryExpression(ast);

		if (peaked.type == TokenType.Symbol && (peaked.value == "." || peaked.value == "[" || peaked.value == "->")) {
			const tempVarName = `__func_ret_temp_${id++}`;
			const tempVarDecl: VariableDeclaration = {
				type: ASTType.VariableDeclaration,
				name: tempVarName,
				variableType: null, // Infer type
				initializer: ast,
				arraySizeExpression: null
			};

			const remainingRef = this.parseIdentifier(tempVarName, 0);
			const block: Block = {
				type: ASTType.Block,
				body: [tempVarDecl, remainingRef]
			};

			return this.maybeStartBinaryExpressionOrBlockedReference(block);
		}

		return ast;
	}

	private parseSymbol(symbol: string) {
		switch (symbol) {
			case ";":
				const semi: Semicolon = { type: ASTType.Semicolon };
				return semi;
			case "{":
				return this.parseInitializer();
			case "(":
				const inner = this.parseStatement();
				this.tokenStream.consumeTV(TokenType.Symbol, ")");
				return this.maybeStartBinaryExpressionOrBlockedReference(inner);
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

		return this.maybeStartBinaryExpressionOrBlockedReference(lit);
	}
}

export { Parser };
