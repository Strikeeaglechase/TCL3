export enum ASTType {
	Program = "Program",
	FunctionDeclaration = "FunctionDeclaration",
	WrappedTypeRef = "WrappedTypeRef",
	RawTypeRef = "RawTypeRef",
	Reference = "Reference",
	ReturnStatement = "ReturnStatement",
	BinaryExpression = "BinaryExpression",
	StructDeclaration = "StructDeclaration",
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
	Out = "Out"
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

export interface RawTypeRef extends ASTNode {
	type: ASTType.RawTypeRef;
	rawType: string;
}

export interface Reference extends ASTNode {
	type: ASTType.Reference;
	identifier: string;
	offsetExpressions: AST[] | null;
	child: Reference | null;
	dereferenceForChild: boolean;
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

// export interface StructInitializer extends ASTNode {
// 	type: ASTType.StructInitializer;
// 	fields: { name: string; expression: AST }[];
// }

// export interface ArrayInitializer extends ASTNode {
// 	type: ASTType.ArrayInitializer;
// 	values: AST[];
// }

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

export interface OutStatement extends ASTNode {
	type: ASTType.Out;
	expression: AST;
}

export type ASTTypeRef = WrappedTypeRef | RawTypeRef;

export type AST =
	| Program
	| FunctionDeclaration
	| WrappedTypeRef
	| RawTypeRef
	| Reference
	| ReturnStatement
	| BinaryExpression
	| StructDeclaration
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
	| OutStatement;
