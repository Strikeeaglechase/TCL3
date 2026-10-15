import { AST, ASTType } from "./ast.js";

type WalkHandlersMap = { [K in AST["type"]]: (node: Extract<AST, { type: K }>, visitor: (node: AST) => void) => void };
const walkNodeHandlers: WalkHandlersMap = {
	[ASTType.Program]: (node, visitor) => node.body.forEach(visitor),
	[ASTType.BinaryExpression]: (node, visitor) => {
		visitor(node.left);
		visitor(node.right);
	},
	[ASTType.UnaryExpression]: (node, visitor) => visitor(node.operand),
	[ASTType.FunctionDeclaration]: (node, visitor) => node.body.forEach(visitor),
	[ASTType.VariableDeclaration]: (node, visitor) => {
		visitor(node.arraySizeExpression);
		visitor(node.initializer);
	},
	[ASTType.Reference]: (node, visitor) => visitor(node.child),
	[ASTType.VariableAssignment]: (node, visitor) => {
		visitor(node.reference);
		visitor(node.expression);
	},
	[ASTType.FunctionCall]: (node, visitor) => {
		visitor(node.reference);
		node.arguments.forEach(visitor);
	},
	[ASTType.IfStatement]: (node, visitor) => {
		visitor(node.condition);
		node.thenBody.forEach(visitor);
		node.elseIfs.forEach(v => {
			visitor(v.condition);
			v.body.forEach(visitor);
		});
		if (node.elseBody) node.elseBody.forEach(visitor);
	},
	[ASTType.ForLoop]: (node, visitor) => {
		visitor(node.initializer);
		visitor(node.condition);
		visitor(node.increment);
		node.body.forEach(visitor);
	},
	[ASTType.WhileLoop]: (node, visitor) => {
		visitor(node.condition);
		node.body.forEach(visitor);
	},
	[ASTType.ReturnStatement]: (node, visitor) => visitor(node.expression),
	[ASTType.Literal]: () => {},
	[ASTType.Semicolon]: () => {},
	[ASTType.Out]: (node, visitor) => visitor(node.expression),
	[ASTType.Block]: (node, visitor) => node.body.forEach(visitor),
	[ASTType.Dereference]: (node, visitor) => visitor(node.operand),
	[ASTType.AddressOf]: (node, visitor) => visitor(node.reference),
	[ASTType.WrappedTypeRef]: (node, visitor) => visitor(node.inner),
	[ASTType.FunctionTypeRef]: (node, visitor) => {
		node.parameters.forEach(visitor);
		visitor(node.returnType);
	},
	[ASTType.RawTypeRef]: () => {},
	[ASTType.StructDeclaration]: (node, visitor) => {
		node.fields.forEach(field => visitor(field.type));
		node.methods.forEach(method => visitor(method));
	},
	[ASTType.EnumDeclaration]: () => {},
	[ASTType.Initializer]: (node, visitor) => node.values.forEach(visitor),
	[ASTType.StructFieldInitializer]: (node, visitor) => visitor(node.expression),
	[ASTType.BreakStatement]: () => {},
	[ASTType.ContinueStatement]: () => {},
	[ASTType.TypeCast]: (node, visitor) => {
		visitor(node.castType);
		visitor(node.expression);
	}
};

const walk = (node: AST, visitor: (node: AST, depth: number) => void, depth = 0) => {
	if (!node) return;
	visitor(node, depth);

	const handler = walkNodeHandlers[node.type] as (node: AST, visitor: (node: AST, depth: number) => void) => void;
	handler(node, childNode => {
		walk(childNode, visitor, depth + 1);
	});
};

export { walk, walkNodeHandlers };
