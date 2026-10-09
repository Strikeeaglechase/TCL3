export enum ASTType {
	Program = "Program",
	FunctionDeclaration = "FunctionDeclaration",
	WrappedTypeRef = "WrappedTypeRef",
	FunctionTypeRef = "FunctionTypeRef",
	RawTypeRef = "RawTypeRef",
	Reference = "Reference",
	ReturnStatement = "ReturnStatement",
	BinaryExpression = "BinaryExpression",
	UnaryExpression = "UnaryExpression",
	StructDeclaration = "StructDeclaration",
	EnumDeclaration = "EnumDeclaration",
	// StructInitializer = "StructInitializer",
	// ArrayInitializer = "ArrayInitializer",
	Initializer = "Initializer",
	StructFieldInitializer = "StructFieldInitializer",
	VariableDeclaration = "VariableDeclaration",
	VariableAssignment = "VariableAssignment",
	FunctionCall = "FunctionCall",
	Semicolon = "Semicolon",
	Literal = "Literal",
	AddressOf = "AddressOf",
	Dereference = "Dereference",
	Out = "Out",
	ForLoop = "ForLoop",
	WhileLoop = "WhileLoop",
	IfStatement = "IfStatement",
	Block = "Block",
	BreakStatement = "BreakStatement",
	ContinueStatement = "ContinueStatement"
}

export interface ASTNode {
	type: ASTType;
}

export interface Program extends ASTNode {
	type: ASTType.Program;
	body: AST[];
}

export interface FunctionDeclaration extends ASTNode {
	type: ASTType.FunctionDeclaration;
	name: string;
	parameters: { name: string; type: ASTTypeRef }[];
	returnType: ASTTypeRef;
	body: AST[];
}

export interface WrappedTypeRef extends ASTNode {
	type: ASTType.WrappedTypeRef;
	inner: ASTTypeRef;
}

export interface FunctionTypeRef extends ASTNode {
	type: ASTType.FunctionTypeRef;
	parameters: ASTTypeRef[];
	returnType: ASTTypeRef;
}

export interface RawTypeRef extends ASTNode {
	type: ASTType.RawTypeRef;
	rawType: string;
}

export interface Reference extends ASTNode {
	type: ASTType.Reference;
	identifier: string;
	offsetExpressions: AST[] | null;
	child: Reference | null;
	dereferenceCount: number;
}

export interface ReturnStatement extends ASTNode {
	type: ASTType.ReturnStatement;
	expression: AST | null;
}

export interface BinaryExpression extends ASTNode {
	type: ASTType.BinaryExpression;
	left: AST;
	operator: string;
	right: AST;
}

export interface StructDeclaration extends ASTNode {
	type: ASTType.StructDeclaration;
	name: string;
	fields: { name: string; type: ASTTypeRef }[];
	methods: FunctionDeclaration[];
}

export interface EnumDeclaration extends ASTNode {
	type: ASTType.EnumDeclaration;
	name: string;
	variants: { name: string; value: number }[];
}

export interface Initializer extends ASTNode {
	type: ASTType.Initializer;
	values: AST[];
}

export interface StructFieldInitializer extends ASTNode {
	type: ASTType.StructFieldInitializer;
	name: string;
	expression: AST;
}

export interface VariableDeclaration extends ASTNode {
	type: ASTType.VariableDeclaration;
	name: string;
	variableType: ASTTypeRef;
	initializer: AST;
	arraySizeExpression: AST | null;
}

export interface Assignment extends ASTNode {
	type: ASTType.VariableAssignment;
	reference: Reference;
	expression: AST;
}

export interface FunctionCall extends ASTNode {
	type: ASTType.FunctionCall;
	reference: Reference;
	arguments: AST[];
}

export interface Semicolon extends ASTNode {
	type: ASTType.Semicolon;
}

export interface Literal extends ASTNode {
	type: ASTType.Literal;
	value: string;
	literalType: "number" | "string";
}

export interface AddressOf extends ASTNode {
	type: ASTType.AddressOf;
	reference: Reference;
}

export interface Dereference extends ASTNode {
	type: ASTType.Dereference;
	operand: AST;
	dereferenceCount: number;
}

export interface OutStatement extends ASTNode {
	type: ASTType.Out;
	expression: AST;
}

export interface UnaryExpression extends ASTNode {
	type: ASTType.UnaryExpression;
	operator: string;
	operand: AST;
}

export interface ForLoop extends ASTNode {
	type: ASTType.ForLoop;
	initializer: AST;
	condition: AST;
	increment: AST;
	body: AST[];
}

export interface WhileLoop extends ASTNode {
	type: ASTType.WhileLoop;
	condition: AST;
	body: AST[];
}

export interface IfStatement extends ASTNode {
	type: ASTType.IfStatement;
	condition: AST;
	thenBody: AST[];
	elseBody: AST[] | null;
	elseIfs: { condition: AST; body: AST[] }[];
}

export interface Block extends ASTNode {
	type: ASTType.Block;
	body: AST[];
}

export interface BreakStatement extends ASTNode {
	type: ASTType.BreakStatement;
}

export interface ContinueStatement extends ASTNode {
	type: ASTType.ContinueStatement;
}

export type ASTTypeRef = WrappedTypeRef | FunctionTypeRef | RawTypeRef;

export type AST =
	| Program
	| FunctionDeclaration
	| RawTypeRef
	| WrappedTypeRef
	| FunctionTypeRef
	| Reference
	| ReturnStatement
	| BinaryExpression
	| UnaryExpression
	| StructDeclaration
	| EnumDeclaration
	// | StructInitializer
	// | ArrayInitializer
	| Initializer
	| StructFieldInitializer
	| VariableDeclaration
	| Assignment
	| FunctionCall
	| Semicolon
	| Literal
	| AddressOf
	| OutStatement
	| ForLoop
	| WhileLoop
	| IfStatement
	| Block
	| Dereference
	| BreakStatement
	| ContinueStatement;
