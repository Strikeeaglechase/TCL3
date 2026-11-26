import { AST, ASTType, FunctionDeclaration, Reference } from "../parser/ast.js";
import { Compiler } from "./compiler.js";
import { FunctionContext } from "./functionContext.js";

const UNINITIALIZED = 1;
const LIVE = 2;
const MOVED = 4;
type State = Map<string, number>;

// This pass checks ownership independently of IR emission. Frame slots remain function-wide,
// while a declaration's live value ends at the end of its enclosing body.
export class LifetimeChecker {
	private state: State = new Map();
	private readonly tracked = new Set<string>();

	constructor(
		private compiler: Compiler,
		private context: FunctionContext,
		private definition: FunctionDeclaration
	) {
		for (const name of context.getDestructibleLocals()) {
			this.tracked.add(name);
			this.state.set(name, context.isParameter(name) ? LIVE : UNINITIALIZED);
		}
	}

	public check() {
		this.body(this.definition.body, false);
	}

	private merge(...states: State[]): State {
		const result: State = new Map();
		for (const name of this.tracked)
			result.set(
				name,
				states.reduce((bits, state) => bits | (state.get(name) ?? UNINITIALIZED), 0)
			);
		return result;
	}

	private requireLive(name: string) {
		if (!this.tracked.has(name)) return;
		const state = this.state.get(name);
		if (state != LIVE) throw new Error(`Cannot use '${name}': its destructible value is ${state == MOVED ? "moved" : "not live on every path"}.`);
	}

	private isDirect(ref: Reference) {
		return !ref.child && !ref.offsetExpressions && !ref.dereferenceCount;
	}

	private reference(ref: Reference, consume: boolean) {
		for (let part: Reference = ref; part; part = part.child) part.offsetExpressions?.forEach(index => this.expression(index, false));
		if (consume && this.compiler.isDestructibleType(this.compiler.inferTypeFrom(ref)) && !this.isDirect(ref))
			throw new Error(`Moving a struct field or array element is not supported yet.`);
		if (!this.tracked.has(ref.identifier)) return;
		this.requireLive(ref.identifier);
		if (!consume || !this.compiler.isDestructibleType(this.compiler.inferTypeFrom(ref))) return;
		this.state.set(ref.identifier, MOVED);
	}

	private expression(node: AST, consume: boolean) {
		if (!node) return;
		switch (node.type) {
			case ASTType.Reference:
				this.reference(node, consume);
				return;
			case ASTType.FunctionCall: {
				if (!node.reference.child && node.reference.identifier == "sizeof") return;
				if (node.reference.child && this.tracked.has(node.reference.identifier)) this.requireLive(node.reference.identifier);
				node.arguments.forEach(arg => this.expression(arg, true));
				const last = (() => {
					let part = node.reference;
					while (part.child) part = part.child;
					return part;
				})();
				if (last.identifier == "drop" && this.context.name == "drop" && this.isDirect({ ...node.reference, child: null })) {
					if (this.tracked.has(node.reference.identifier)) this.state.set(node.reference.identifier, MOVED);
				}
				if (!consume && this.compiler.isDestructibleType(this.compiler.inferTypeFrom(node)))
					throw new Error(`A destructible temporary must be moved into a destination.`);
				return;
			}
			case ASTType.TypeCast:
				this.expression(node.expression, consume);
				return;
			case ASTType.AddressOf:
				this.reference(node.reference, false);
				return;
			case ASTType.Dereference:
				this.expression(node.operand, false);
				if (consume && this.compiler.isDestructibleType(this.compiler.inferTypeFrom(node)))
					throw new Error(`Moving a value through a pointer is not supported yet.`);
				return;
			case ASTType.BinaryExpression:
				this.expression(node.left, false);
				this.expression(node.right, false);
				if (!consume && this.compiler.isDestructibleType(this.compiler.inferTypeFrom(node)))
					throw new Error(`A destructible expression result must be moved into a destination.`);
				return;
			case ASTType.UnaryExpression:
				this.expression(node.operand, false);
				return;
			case ASTType.Initializer:
				node.values.forEach(value => this.expression(value, true));
				return;
			case ASTType.StructFieldInitializer:
				this.expression(node.expression, true);
				return;
			case ASTType.Block:
				if (
					node.body.some(
						part =>
							part.type == ASTType.VariableDeclaration &&
							part.name.startsWith("__func_ret_temp_") &&
							this.compiler.isDestructibleType(part.variableType ?? this.compiler.inferTypeFrom(part.initializer))
					)
				)
					throw new Error(`Chained expressions with a destructible temporary are not supported yet.`);
				this.body(node.body, true);
				return;
			case ASTType.Literal:
			case ASTType.Semicolon:
			case ASTType.LambdaExpression:
				return;
			default:
				throw new Error(`Lifetime checker cannot evaluate ${node.type} as an expression.`);
		}
	}

	private body(nodes: AST[], scoped: boolean): boolean {
		const declared: string[] = [];
		let reachesEnd = true;
		for (const node of nodes) {
			if (!reachesEnd) break;
			if (node.type == ASTType.VariableDeclaration && this.tracked.has(node.name)) declared.push(node.name);
			reachesEnd = this.statement(node);
		}
		if (scoped) declared.forEach(name => this.state.set(name, UNINITIALIZED));
		return reachesEnd;
	}

	private statement(node: AST): boolean {
		switch (node.type) {
			case ASTType.FunctionCall:
				this.expression(node, true);
				return true;
			case ASTType.VariableDeclaration:
				this.expression(node.arraySizeExpression, false);
				this.expression(node.initializer, true);
				if (this.tracked.has(node.name)) this.state.set(node.name, LIVE);
				return true;
			case ASTType.VariableAssignment:
				this.expression(node.expression, true);
				if (this.isDirect(node.reference) && this.tracked.has(node.reference.identifier)) this.state.set(node.reference.identifier, LIVE);
				else this.reference(node.reference, false);
				return true;
			case ASTType.ReturnStatement:
				this.expression(node.expression, true);
				return false;
			case ASTType.Out:
				this.expression(node.expression, false);
				return true;
			case ASTType.IfStatement: {
				this.expression(node.condition, false);
				const entry = new Map(this.state);
				const ends: State[] = [];
				if (this.body(node.thenBody, true)) ends.push(new Map(this.state));
				for (const branch of node.elseIfs) {
					this.state = new Map(entry);
					this.expression(branch.condition, false);
					if (this.body(branch.body, true)) ends.push(new Map(this.state));
				}
				if (node.elseBody) {
					this.state = new Map(entry);
					if (this.body(node.elseBody.body ?? [], true)) ends.push(new Map(this.state));
				} else ends.push(entry);
				if (ends.length > 0) this.state = this.merge(...ends);
				return ends.length > 0;
			}
			case ASTType.WhileLoop:
			case ASTType.ForLoop: {
				if (node.type == ASTType.ForLoop) this.statement(node.initializer);
				this.expression(node.condition, false);
				const entry = new Map(this.state);
				this.body(node.body, true);
				if (node.type == ASTType.ForLoop) this.statement(node.increment);
				const afterIteration = new Map(this.state);
				this.state = this.merge(entry, afterIteration);
				this.expression(node.condition, false);
				this.body(node.body, true); // Validate another iteration with the joined entry state.
				if (node.type == ASTType.ForLoop) this.statement(node.increment);
				this.state = this.merge(entry, afterIteration, this.state);
				if (node.type == ASTType.ForLoop && node.initializer.type == ASTType.VariableDeclaration) this.state.set(node.initializer.name, UNINITIALIZED);
				return true;
			}
			case ASTType.Block:
				this.expression(node, false);
				return true;
			case ASTType.BreakStatement:
			case ASTType.ContinueStatement:
				return false;
			case ASTType.Semicolon:
				return true;
			default:
				this.expression(node, false);
				return true;
		}
	}
}
