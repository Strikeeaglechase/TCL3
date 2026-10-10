import chalk from "chalk";

import { IRArgument, Register } from "../ir/ir.js";
import { imm, INT_SIZE, IRBuilder, label, memReg, reg, str, ThreeArgInstructions } from "../ir/irBuilder.js";
import {
	Assignment,
	AST,
	ASTType,
	ASTTypeRef,
	BinaryExpression,
	BreakStatement,
	ContinueStatement,
	Dereference,
	EnumDeclaration,
	ForLoop,
	FunctionCall,
	FunctionDeclaration,
	FunctionTypeRef,
	IfStatement,
	Literal,
	OutStatement,
	Program,
	RawTypeRef,
	Reference,
	ReturnStatement,
	StructDeclaration,
	TypeCast,
	UnaryExpression,
	VariableDeclaration,
	WhileLoop,
	WrappedTypeRef
} from "../parser/ast.js";
import { BuiltInFunction, builtInFunctions } from "./builtInFunctions.js";
import { FunctionContext } from "./functionContext.js";
import { Enum, Struct } from "./userTypes.js";

/*
IR structure:
Arguments in form of:
IMM(value), REG(registerName), MEM(address), MEM_REG(registerName)
*/

function typeToStr(type: ASTTypeRef): string {
	let result = "";
	let current = type;
	while (true) {
		if (current.type == ASTType.WrappedTypeRef) {
			result += "*";
			current = current.inner;
		} else if (current.type == ASTType.FunctionTypeRef) {
			let fnType = `Fn<`;
			current.parameters.forEach((p, idx) => {
				if (idx > 0) fnType += ", ";
				fnType += typeToStr(p);
			});
			if (current.parameters.length > 0) fnType += ", ";
			fnType += `${typeToStr(current.returnType)}>`;
			result += fnType;
			break;
		} else if (current.type == ASTType.RawTypeRef) {
			result += current.rawType;
			break;
		}
	}

	return result;
}

function referenceToString(ref: Reference): string {
	let result = "";
	let current = ref;
	while (true) {
		result += current.identifier;
		if (current.offsetExpressions != null) {
			current.offsetExpressions.forEach(offsetExpr => (result += `[${offsetExpr.type}]`));
		}

		if (current.dereferenceCount) result += "->";
		else if (current.child) result += ".";

		if (!current.child) break;
		current = current.child;
	}

	return result;
}

let id = 0;

interface FunctionCallInfo {
	getAddress: () => IRArgument;
	addressExtraInstructionCount: number;
	returnType: ASTTypeRef;
	argumentSize: number;
	argumentCount: number;
}

const primitiveSizeMap: Record<string, number> = {
	void: 0,
	int: INT_SIZE
};

const intType = (): RawTypeRef => {
	return { type: ASTType.RawTypeRef, rawType: "int" };
};

const voidType = (): RawTypeRef => {
	return { type: ASTType.RawTypeRef, rawType: "void" };
};

const ptrOf = (type: ASTTypeRef): WrappedTypeRef => {
	return { type: ASTType.WrappedTypeRef, inner: type };
};

class BinaryExpressionTypeEvalResult {
	private constructor(
		public readonly method: FunctionContext,
		public readonly left: AST,
		public readonly right: AST,
		public readonly struct: Struct,

		public readonly failedToEvaluateType: boolean,
		public readonly isOpOverload: boolean
	) {}

	public static failed(): BinaryExpressionTypeEvalResult {
		return new BinaryExpressionTypeEvalResult(null, null, null, null, true, false);
	}

	public static notOpOverload(): BinaryExpressionTypeEvalResult {
		return new BinaryExpressionTypeEvalResult(null, null, null, null, false, false);
	}

	public static opOverload(method: FunctionContext, left: AST, right: AST, struct: Struct): BinaryExpressionTypeEvalResult {
		return new BinaryExpressionTypeEvalResult(method, left, right, struct, false, true);
	}
}

class Compiler {
	private currentContext: FunctionContext = null;

	public builder: IRBuilder = new IRBuilder();
	protected structs: Map<string, Struct> = new Map();
	private enums: Map<string, Enum> = new Map();
	public functions: Map<string, FunctionContext[]> = new Map();
	private mainLabel: string = "main";

	private continueLabelStack: string[] = [];
	private get continueLabel(): string {
		return this.continueLabelStack[this.continueLabelStack.length - 1];
	}
	private breakLabelStack: string[] = [];
	private get breakLabel(): string {
		return this.breakLabelStack[this.breakLabelStack.length - 1];
	}

	constructor(private program: Program) {}

	public compile() {
		this.builder.move(imm(255), reg(Register.memPtr));
		this.builder.move(label(this.mainLabel), reg(Register.pc));

		this.program.body.forEach(node => {
			this.compileAst(node);
		});

		this.builder.halt();
		return this.builder.getCode();
	}

	public resolveTypeSize(type: ASTTypeRef) {
		if (type.type === ASTType.WrappedTypeRef || type.type == ASTType.FunctionTypeRef) return INT_SIZE;

		if (primitiveSizeMap[type.rawType] !== undefined) return primitiveSizeMap[type.rawType];

		if (this.structs.has(type.rawType)) {
			const struct = this.structs.get(type.rawType);
			return struct.size;
		}

		if (this.enums.has(type.rawType)) {
			return INT_SIZE; // Enums are represented as integers
		}

		throw new Error(`Unsupported type: ${type.rawType}`);
	}

	protected compileAst(node: AST) {
		switch (node.type) {
			case ASTType.FunctionDeclaration:
				this.handleTopLevelFunctionDeclaration(node);
				break;
			case ASTType.StructDeclaration:
				this.handleStructDeclaration(node);
				break;
			case ASTType.VariableDeclaration:
				this.handleVariableDeclaration(node);
				break;
			case ASTType.BinaryExpression:
				this.handleBinaryExpression(node);
				break;
			case ASTType.Reference:
				this.handleReferenceRead(node);
				break;
			case ASTType.Semicolon:
				break;
			case ASTType.ReturnStatement:
				this.handleReturnStatement(node);
				break;
			case ASTType.Literal:
				this.handleLiteral(node);
				break;
			case ASTType.FunctionCall:
				this.handleFunctionCall(node);
				break;
			case ASTType.AddressOf:
				this.handleReferenceRead(node.reference, true);
				break;
			case ASTType.Dereference:
				this.handleDereference(node);
				break;
			case ASTType.Out:
				this.handleOutStatement(node);
				break;
			case ASTType.ForLoop:
				this.handleForLoop(node);
				break;
			case ASTType.IfStatement:
				this.handleIfStatement(node);
				break;
			case ASTType.WhileLoop:
				this.handleWhileLoop(node);
				break;
			case ASTType.VariableAssignment:
				this.handleAssignment(node);
				break;
			case ASTType.EnumDeclaration:
				this.handleEnumDeclaration(node);
				break;
			case ASTType.UnaryExpression:
				this.handleUnaryExpression(node);
				break;
			case ASTType.Block:
				node.body.forEach(bodyNode => this.compileAst(bodyNode));
				break;
			case ASTType.BreakStatement:
				this.handleBreakStatement(node);
				break;
			case ASTType.ContinueStatement:
				this.handleContinueStatement(node);
				break;
			case ASTType.TypeCast:
				this.handleTypeCast(node);
				break;
			default:
				throw new Error(`Unsupported AST node type: ${node.type}`);
		}
	}

	private handleTypeCast(node: TypeCast) {
		this.compileAst(node.expression);
	}

	private handleDereference(node: Dereference) {
		const innerType = this.inferTypeFrom(node.operand);
		if (innerType == null) throw new Error(`Dereference of non-obvious reference failed due to inability to infer type of operand.`);
		if (innerType.type != ASTType.WrappedTypeRef) throw new Error(`Cannot dereference non-pointer type '${typeToStr(innerType)}'.`);

		this.builder.comment(`Dereference operand`);
		this.compileAst(node.operand);
		this.builder.pop(reg(Register.r0));

		let currentType = innerType.inner;
		// Don't do final dereference as we want to leave a pointer in order to read the value from it
		for (let i = 0; i < node.dereferenceCount - 1; i++) {
			if (currentType.type != ASTType.WrappedTypeRef) throw new Error(`Cannot dereference non-pointer type '${typeToStr(currentType)}'.`);

			this.builder.comment(`Dereference level ${i + 1}`);
			this.builder.move(memReg(Register.r0), reg(Register.r0)); // Dereference r0 to get the pointer to the next level
		}

		if (currentType.type != ASTType.WrappedTypeRef) throw new Error(`Cannot dereference non-pointer type '${typeToStr(currentType)}'.`);
		const finalTypeSize = this.resolveTypeSize(currentType.inner);
		for (let i = 0; i < finalTypeSize; i++) {
			this.builder.push(memReg(Register.r0, i));
		}
	}

	private handleContinueStatement(node: ContinueStatement) {
		if (this.continueLabel == null) throw new Error(`Continue statement used outside of a loop context.`);
		this.builder.comment(`Continue statement`);
		this.builder.jump(label(this.continueLabel));
	}

	private handleBreakStatement(node: BreakStatement) {
		if (this.breakLabel == null) throw new Error(`Break statement used outside of a loop context.`);
		this.builder.comment(`Break statement`);
		this.builder.jump(label(this.breakLabel));
	}

	private handleForLoop(node: ForLoop) {
		this.compileAst(node.initializer);
		const loopTopLabel = `for_loop_top_${id++}`;
		const loopEndLabel = `for_loop_end_${id++}`;

		this.continueLabelStack.push(loopTopLabel);
		this.breakLabelStack.push(loopEndLabel);

		this.builder.addLabel(loopTopLabel);
		this.compileAst(node.condition);
		this.builder.pop(reg(Register.r0));
		this.builder.jumpIfFalse(reg(Register.r0), label(loopEndLabel));

		node.body.forEach(bodyNode => this.compileAst(bodyNode));
		this.compileAst(node.increment);
		this.builder.jump(label(loopTopLabel));
		this.builder.addLabel(loopEndLabel);

		this.continueLabelStack.pop();
		this.breakLabelStack.pop();
	}

	private handleIfStatement(node: IfStatement) {
		const thenBodyEnd = `if_then_end_${id++}`;
		const ifEnd = node.elseBody || node.elseIfs.length > 0 ? `if_end_${id++}` : null;

		this.compileAst(node.condition);
		this.builder.pop(reg(Register.r0));
		this.builder.jumpIfFalse(reg(Register.r0), label(thenBodyEnd));
		node.thenBody.forEach(bodyNode => this.compileAst(bodyNode));
		if (ifEnd) this.builder.jump(label(ifEnd));
		this.builder.addLabel(thenBodyEnd);

		node.elseIfs.forEach(elseIf => {
			const elifEnd = `elif_end_${id++}`;

			this.compileAst(elseIf.condition);
			this.builder.pop(reg(Register.r0));
			this.builder.jumpIfFalse(reg(Register.r0), label(elifEnd));

			elseIf.body.forEach(bodyNode => this.compileAst(bodyNode));
			this.builder.jump(label(ifEnd));
			this.builder.addLabel(elifEnd);
		});

		if (node.elseBody) node.elseBody.forEach(bodyNode => this.compileAst(bodyNode));

		if (ifEnd) this.builder.addLabel(ifEnd);
	}

	private handleWhileLoop(node: WhileLoop) {
		const loopTopLabel = `while_loop_top_${id++}`;
		const loopEndLabel = `while_loop_end_${id++}`;

		this.continueLabelStack.push(loopTopLabel);
		this.breakLabelStack.push(loopEndLabel);

		this.builder.addLabel(loopTopLabel);

		this.compileAst(node.condition);
		this.builder.pop(reg(Register.r0));
		this.builder.jumpIfFalse(reg(Register.r0), label(loopEndLabel));

		node.body.forEach(bodyNode => this.compileAst(bodyNode));

		this.builder.jump(label(loopTopLabel));
		this.builder.addLabel(loopEndLabel);

		this.continueLabelStack.pop();
		this.breakLabelStack.pop();
	}

	private handleAssignment(node: Assignment) {
		if (!this.currentContext) throw new Error(`Unexpected assignment outside of a function context.`);
		this.builder.comment(`Assignment to ${referenceToString(node.reference)}`);

		const expressionType = this.inferTypeFrom(node.expression);
		const refType = this.inferTypeFrom(node.reference);

		if (expressionType == null || refType == null) {
			console.log(
				chalk.yellow(
					`Could not infer type for assignment: reference '${refType ? typeToStr(refType) : `unknown: ${node.reference.type}`}', expression '${expressionType ? typeToStr(expressionType) : `unknown: ${node.expression.type}`}'`
				)
			);
		} else {
			if (!this.areTypesEqual(expressionType, refType)) {
				// throw new Error(`Type mismatch in assignment, expression type: ${typeToStr(expressionType)}, reference type: ${typeToStr(refType)}`);
				console.log(chalk.yellow(`Type mismatch in assignment: reference '${typeToStr(refType)}' != expression '${typeToStr(expressionType)}'`));
			}
		}

		// Evaluate the expression, expect result on the stack
		this.compileAst(node.expression);

		const ref = node.reference;

		// Simple full assignment to local variable
		if (!ref.child && ref.offsetExpressions == null) {
			if (ref.dereferenceCount == 0) {
				this.builder.comment(`Simple assignment to local variable: ${ref.identifier}`);
				this.currentContext.writeVarFromStack(ref.identifier);
			} else {
				this.builder.comment(`Assignment to pointer variable: ${ref.identifier} with deref count ${ref.dereferenceCount}`);
				this.currentContext.useVariableAsPointerAndSetFromStack(ref.identifier, 0, ref.dereferenceCount);
			}
			return;
		}

		// Perhaps it's a simple struct assignment (chain) without any derefs or offset expressions
		const { offset, readType } = this.getReferenceOffsetWithoutDerefs(ref);
		if (offset >= 0) {
			this.builder.comment(`Simple struct assignment to local variable: ${ref.identifier} with offset ${offset}`);
			this.currentContext.writeVarFromStack(ref.identifier, offset, this.resolveTypeSize(readType));
			return;
		}

		// Not simple assignment, evaluate by calculating the address in r0
		const resolveType = this.resolveComplexReferenceAddressInR0(ref);
		const finalTypeSize = this.resolveTypeSize(resolveType);

		this.builder.comment(`Copy ${finalTypeSize} cells from stack to address in r0 for assignment to ${referenceToString(ref)}`);
		// Copy off stack into where r0 points to
		for (let i = 0; i < finalTypeSize; i++) {
			const stackOffset = -finalTypeSize + i; // Reverse order to pop off stack
			this.builder.move(memReg(Register.sp, stackOffset), memReg(Register.r0, i));
		}

		// Adjust stack pointer to remove the values we just popped off
		this.builder.sub(reg(Register.sp), imm(finalTypeSize), reg(Register.sp));
	}

	private resolveComplexReferenceAddressInR0(node: Reference) {
		let curRef = node;
		let currentType = this.currentContext.getTypeOfLocal(curRef.identifier);

		// Set r0 to pointer to the base of the reference
		this.builder.comment(`Address of '${curRef.identifier}'`);
		this.currentContext.getAddressOfLocalInRegister(curRef.identifier, Register.r0);
		let top = true;
		while (true) {
			// Evaluate the identifier offset
			if (!top) {
				if (currentType.type != ASTType.RawTypeRef)
					throw new Error(`Attempt to access field '${curRef.identifier}' of a non-raw type '${typeToStr(currentType)}'.`);

				const structDef = this.structs.get(currentType.rawType);
				if (!structDef) throw new Error(`Type information for '${currentType.rawType}' is not available, cannot access field '${curRef.identifier}'.`);

				const field = structDef.fields.get(curRef.identifier);
				if (!field) throw new Error(`Struct type '${currentType.rawType}' does not have a field named '${curRef.identifier}'.`);

				this.builder.comment(`Struct field ${curRef.identifier} at offset ${field.offset}`);
				this.builder.add(reg(Register.r0), imm(field.offset), reg(Register.r0));
				currentType = field.type;
			}
			top = false;

			// Handle array offset expressions
			if (curRef.offsetExpressions != null) {
				// Evaluate the offset expression and add it to r0
				// Eval may modify r0
				curRef.offsetExpressions.forEach(offsetExpr => {
					if (currentType.type != ASTType.WrappedTypeRef)
						throw new Error(`Attempt to index a non-pointer type '${typeToStr(currentType)}' for reference '${curRef.identifier}'.`);

					// Perform dereference
					this.builder.comment(`Deref for array`);
					this.builder.move(memReg(Register.r0), reg(Register.r0));
					currentType = currentType.inner;

					this.builder.push(reg(Register.r0));
					this.builder.comment(`Offset expression for index into '${curRef.identifier}'`);
					this.compileAst(offsetExpr);
					this.builder.pop(reg(Register.r1)); // Result of the offset expression
					this.builder.mul(reg(Register.r1), imm(this.resolveTypeSize(currentType)), reg(Register.r1)); // Multiply by size of the type
					this.builder.pop(reg(Register.r0)); // Restore r0 to the current pointer
					this.builder.add(reg(Register.r0), reg(Register.r1), reg(Register.r0)); // Add the offset to the pointer
				});
			}

			// Attempting to access a struct field, but the struct ref is a pointer
			// Implements the -> notation
			// Must be done after offset (array) expressions
			for (let i = 0; i < curRef.dereferenceCount; i++) {
				if (currentType.type != ASTType.WrappedTypeRef)
					throw new Error(`Attempt to dereference a non-pointer type '${typeToStr(currentType)}' for reference '${curRef.identifier}'.`);

				this.builder.comment(`Deref for child ${curRef.identifier}`);
				this.builder.move(memReg(Register.r0), reg(Register.r0)); // Dereference r0 to get the pointer to the next level
				currentType = currentType.inner;
			}

			if (!curRef.child) break;
			curRef = curRef.child;
		}

		return currentType;
	}

	// AddressOf prevents the final dereference we will do
	private handleReferenceRead(node: Reference, addressOf = false) {
		if (!this.currentContext) throw new Error(`Unexpected reference outside of a function context.`);
		this.builder.comment(`Reference: ${referenceToString(node)}${addressOf ? " (addressOf)" : ""}`);

		// Yay! Very simple reference type, direct stack access that we should have in local ctx
		if (!addressOf && !node.child && node.offsetExpressions == null) {
			if (node.dereferenceCount == 0) {
				this.builder.comment(`Simple reference to local variable: ${node.identifier}`);
				this.currentContext.readVarToStack(node.identifier);
			} else {
				this.builder.comment(`Simple dereference of local variable: ${node.identifier}`);
				this.currentContext.useVariableAsPointerAndReadToStack(node.identifier, node.dereferenceCount);
			}
			return;
		}

		// Enum ref?
		if (this.enums.has(node.identifier)) {
			if (addressOf) throw new Error(`Cannot take address of enum variant.`);
			const enumDecl = this.enums.get(node.identifier);
			const enumKey = enumDecl.variants.get(node.child.identifier);
			if (enumKey === undefined) throw new Error(`Enum '${node.identifier}' does not have a variant named '${node.child.identifier}'.`);

			this.builder.push(imm(enumKey));
			return;
		}

		// Perhaps it's a simple struct access (chain) without any derefs or offset expressions
		const { offset, readType } = this.getReferenceOffsetWithoutDerefs(node);
		if (!addressOf && offset >= 0) {
			this.builder.comment(`Simple struct reference to local variable: ${node.identifier} with offset ${offset}`);
			this.currentContext.readVarToStack(node.identifier, offset, this.resolveTypeSize(readType));
			return;
		}

		// Not simple reference, evaluate by calculating the address in r0

		const resolveType = this.resolveComplexReferenceAddressInR0(node);
		// r0 should now point to our data
		if (addressOf) {
			this.builder.push(reg(Register.r0));
			return;
		}

		const finalTypeSize = this.resolveTypeSize(resolveType);
		this.builder.comment(`Reference resolved, push ${finalTypeSize} cells`);
		for (let i = 0; i < finalTypeSize; i++) {
			this.builder.push(memReg(Register.r0, i));
		}
	}

	// Walks the reference chain, but just returns the type. Does not emit any instructions
	protected getFinalTypeOfReference(
		node: Reference,
		suppressUndefinedVariableError = false // Support for type inference when not all variables have yet been resolved
	): { type: ASTTypeRef; isMethod: boolean; methodStructDecl?: Struct } {
		if (!this.currentContext) throw new Error(`Unexpected reference outside of a function context.`);

		if (!node.child && node.offsetExpressions == null) {
			if (suppressUndefinedVariableError && !this.currentContext.isDefined(node.identifier)) return null;
			if (node.dereferenceCount > 0) {
				let curType = this.currentContext.getTypeOfLocal(node.identifier);
				for (let i = 0; i < node.dereferenceCount; i++) {
					if (curType.type != ASTType.WrappedTypeRef)
						throw new Error(`Attempt to dereference a non-pointer type '${typeToStr(curType)}' for reference '${node.identifier}'.`);
					curType = curType.inner;
				}

				return { type: curType, isMethod: false };
			} else {
				return { type: this.currentContext.getTypeOfLocal(node.identifier), isMethod: false };
			}
		}

		if (this.enums.has(node.identifier)) {
			const enumDecl = this.enums.get(node.identifier);
			if (!enumDecl.variants.has(node.child.identifier))
				throw new Error(`Enum '${node.identifier}' does not have a variant named '${node.child.identifier}'.`);

			return { type: { type: ASTType.RawTypeRef, rawType: enumDecl.name }, isMethod: false };
		}

		if (this.structs.has(node.identifier)) {
			const structDecl = this.structs.get(node.identifier);
			if (!structDecl.methods.has(node.child.identifier))
				throw new Error(`Struct type '${node.identifier}' does not have a method named '${node.child.identifier}'.`);

			const fnList = structDecl.methods.get(node.child.identifier);
			if (fnList == null) throw new Error(`Struct type '${node.identifier}' does not have a method named '${node.child.identifier}'.`);
			if (fnList.length > 1)
				throw new Error(`Static method cannot be overloaded, struct type '${node.identifier}' has multiple methods named '${node.child.identifier}'.`);

			const fn = fnList[0];
			if (!fn.isStatic) throw new Error(`Static method expected, but method '${node.child.identifier}' of struct type '${node.identifier}' is not static.`);

			return { type: fn.type, isMethod: false };
		}

		const { offset, readType } = this.getReferenceOffsetWithoutDerefs(node);
		if (offset >= 0) return { type: readType, isMethod: false };

		let curRef = node;
		if (suppressUndefinedVariableError && !this.currentContext.isDefined(curRef.identifier)) return null;
		let currentType = this.currentContext.getTypeOfLocal(curRef.identifier);

		let top = true;
		while (true) {
			// Evaluate the identifier offset
			if (!top) {
				if (currentType.type != ASTType.RawTypeRef)
					throw new Error(`Attempt to access field '${curRef.identifier}' of a non-raw type '${typeToStr(currentType)}'.`);

				const structDef = this.structs.get(currentType.rawType);
				if (!structDef) throw new Error(`Type information for '${currentType.rawType}' is not available, cannot access field '${curRef.identifier}'.`);

				const field = structDef.fields.get(curRef.identifier);
				if (!field) {
					const fn = structDef.methods.has(curRef.identifier);
					if (!fn) throw new Error(`Struct type '${currentType.rawType}' does not have a field named '${curRef.identifier}'.`);

					return { type: structDef.methods.get(curRef.identifier)[0].type, isMethod: true, methodStructDecl: structDef };
				}

				currentType = field.type;
			}
			top = false;

			if (curRef.offsetExpressions != null) {
				curRef.offsetExpressions.forEach(offsetExpr => {
					if (currentType.type != ASTType.WrappedTypeRef)
						throw new Error(`Attempt to index a non-pointer type '${typeToStr(currentType)}' for reference '${curRef.identifier}'.`);
					currentType = currentType.inner;
				});
			}

			for (let i = 0; i < curRef.dereferenceCount; i++) {
				if (currentType.type != ASTType.WrappedTypeRef)
					throw new Error(`Attempt to dereference a non-pointer type '${typeToStr(currentType)}' for reference '${curRef.identifier}'.`);

				currentType = currentType.inner;
			}

			if (!curRef.child) break;
			curRef = curRef.child;
		}

		return { type: currentType, isMethod: false };
	}

	// Attempts to resolve the offset of a reference for simple absolute struct accesses
	// If the reference requires derefs, returns -1
	private getReferenceOffsetWithoutDerefs(node: Reference) {
		let curRef = node;
		let offset = 0;
		let currentType: ASTTypeRef = null;

		while (true) {
			if (curRef.offsetExpressions != null || curRef.dereferenceCount > 0) return { offset: -1, readType: null };

			if (!curRef.child) return { offset, readType: currentType };

			if (currentType == null) {
				const varType = this.currentContext.getTypeOfLocal(curRef.identifier);
				currentType = varType;
			}

			if (currentType.type == ASTType.WrappedTypeRef)
				throw new Error(`Attempt to access field '${curRef.child.identifier}' of a wrapped type reference '${curRef.identifier}', must dereference.`);
			if (currentType.type == ASTType.FunctionTypeRef) throw new Error(`Attempt to access field of a function type`);

			const structDef = this.structs.get(currentType.rawType);
			if (!structDef) throw new Error(`Attempt to access field '${curRef.child.identifier}' of a non-struct type '${currentType.rawType}'.`);

			const field = structDef.fields.get(curRef.child.identifier);
			if (!field) {
				const isFn = structDef.methods.has(curRef.child.identifier);
				if (!isFn) throw new Error(`Struct type '${currentType.rawType}' does not have a field named '${curRef.child.identifier}'.`);

				// Valid case, however, however no offset exists, caller of getReferenceOffsetWithoutDerefs will handle this case
				return { offset: -1, readType: null };
			}

			offset += field.offset;
			currentType = field.type;

			curRef = curRef.child;
		}
	}

	private handleLiteral(node: Literal) {
		switch (node.literalType) {
			case "number":
				this.builder.push(imm(parseInt(node.value)));
				break;
			case "string":
				const innerStrValue = node.value.slice(1, -1); // Remove quotes
				this.builder.push(str(innerStrValue + "\0"));
				break;
			default:
				throw new Error(`Unsupported literal type: ${node.literalType}`);
		}
	}

	private getMethodForOverloadedBinaryExpression(node: BinaryExpression): BinaryExpressionTypeEvalResult {
		const leftType = this.inferTypeFrom(node.left);
		const rightType = this.inferTypeFrom(node.right);

		if (leftType == null || rightType == null) {
			// console.log(
			// 	chalk.yellow(
			// 		`Could not infer type for binary expression operands, left: ${leftType ? typeToStr(leftType) : `unknown: ${node.left.type}`}, right: ${rightType ? typeToStr(rightType) : `unknown: ${node.right.type}`}`
			// 	)
			// );

			return BinaryExpressionTypeEvalResult.failed();
		} else {
			if (!this.isEffectivelyIntType(leftType) || !this.isEffectivelyIntType(rightType)) {
				// Find type overload for operator
				const commutativeOperators = ["+", "*", "==", "!=", "&", "|", "^"];
				// Ensure that if there's an int op here, it's not the left hand side, as we will expect fn type sigs to be of Fn<struct, int, ret>
				const needsSwap = this.isEffectivelyIntType(leftType) && commutativeOperators.includes(node.operator);

				const opArgs = needsSwap ? [rightType, leftType] : [leftType, rightType];
				const finalLeftType = needsSwap ? rightType : leftType;

				if (finalLeftType.type != ASTType.RawTypeRef)
					throw new Error(`Attempt to perform '${node.operator}' operator on non-raw type '${typeToStr(finalLeftType)}'`);

				const structDef = this.structs.get(finalLeftType.rawType);
				if (!structDef) throw new Error(`Type information for '${finalLeftType.rawType}' is not available, cannot perform operator '${node.operator}'.`);

				const overloadMethods = structDef.methods.get(node.operator);
				if (!overloadMethods) throw new Error(`Struct type '${finalLeftType.rawType}' does not have an overload for operator '${node.operator}'.`);

				// LHS is the struct, first argument will be the this pointer
				const argumentList = [ptrOf(opArgs[0]), opArgs[1]];
				const matchingMethod = this.findFunctionMatchingArgumentList(overloadMethods, argumentList);

				return BinaryExpressionTypeEvalResult.opOverload(matchingMethod, needsSwap ? node.right : node.left, needsSwap ? node.left : node.right, structDef);
			}
		}

		return BinaryExpressionTypeEvalResult.notOpOverload();
	}

	private handleBinaryExpression(node: BinaryExpression) {
		const overloadResult = this.getMethodForOverloadedBinaryExpression(node);
		if (overloadResult.isOpOverload) {
			const { method, left, right, struct } = overloadResult;
			if (left.type != ASTType.Reference) throw new Error(`Left operand of overloaded operator must be a reference to a struct, got ${left.type}`);

			const call: FunctionCall = {
				type: ASTType.FunctionCall,
				reference: left,
				arguments: [right]
			};

			this.callMethod(struct, method.name, call);
			return;
		}

		this.compileAst(node.left);
		this.compileAst(node.right);
		this.builder.pop(reg(Register.r1));
		this.builder.pop(reg(Register.r0));

		const operatorMap: Record<string, keyof ThreeArgInstructions> = {
			"+": "add",
			"-": "sub",
			"*": "mul",
			"/": "div",
			"==": "eq",
			"!=": "neq",
			">": "gt",
			">=": "gte",
			"|": "or",
			"&": "and",
			"^": "xor",
			"<<": "shl",
			">>": "shr",
			"&&": "logic_and",
			"||": "logic_or",
			"%": "mod"
		};

		if (operatorMap[node.operator]) {
			this.builder[operatorMap[node.operator]](reg(Register.r0), reg(Register.r1), reg(Register.r0));
			this.builder.push(reg(Register.r0));
			return;
		}

		switch (node.operator) {
			case "<":
				this.builder.gt(reg(Register.r1), reg(Register.r0), reg(Register.r0));
				break;
			case "<=":
				this.builder.gte(reg(Register.r1), reg(Register.r0), reg(Register.r0));
				break;
			default:
				throw new Error(`Unsupported binary operator: ${node.operator}`);
		}

		this.builder.push(reg(Register.r0));
	}

	private handleUnaryExpression(node: UnaryExpression) {
		this.compileAst(node.operand);
		this.builder.pop(reg(Register.r0));

		switch (node.operator) {
			case "-":
				this.builder.neg(reg(Register.r0), reg(Register.r0));
				break;

			case "!":
				this.builder.eq(reg(Register.r0), imm(0), reg(Register.r0));
				break;

			case "~":
				this.builder.not(reg(Register.r0), reg(Register.r0));
				break;

			default:
				throw new Error(`Unsupported unary operator: ${node.operator}`);
		}

		this.builder.push(reg(Register.r0));
	}

	private handleStructDeclaration(node: StructDeclaration) {
		const struct = new Struct(this, node);
		this.structs.set(node.name, struct);

		// Only build method after the struct is fully defined, so that methods can reference the struct's fields if needed
		struct.buildMethods();
	}

	private handleEnumDeclaration(node: EnumDeclaration) {
		const enumDecl = new Enum(node);
		this.enums.set(node.name, enumDecl);
	}

	public inferTypeFrom(initializer: AST): ASTTypeRef {
		switch (initializer.type) {
			case ASTType.Literal:
				return initializer.literalType == "number" ? intType() : ptrOf(intType()); // All literals are integers for now
			case ASTType.Reference:
				return this.getFinalTypeOfReference(initializer, true)?.type;
			case ASTType.FunctionCall:
				return this.getReturnTypeForCall(initializer);
			// Currently we assume the final expression of a block should be a reference that pushes the value onto the stack
			case ASTType.Block:
				return this.inferTypeFrom(initializer.body[initializer.body.length - 1]);
			case ASTType.AddressOf:
				return ptrOf(this.getFinalTypeOfReference(initializer.reference).type);
			case ASTType.Dereference:
				let operandType = this.inferTypeFrom(initializer.operand);
				for (let i = 0; i < initializer.dereferenceCount; i++) {
					if (operandType.type != ASTType.WrappedTypeRef) throw new Error(`Cannot dereference non-pointer type '${typeToStr(operandType)}'.`);
					operandType = operandType.inner;
				}
				return operandType;
			case ASTType.BinaryExpression:
				return this.evaluateTypeOfBinaryExpression(initializer);
			case ASTType.UnaryExpression:
				return this.inferTypeFrom(initializer.operand);
			case ASTType.TypeCast:
				return initializer.castType;
			case ASTType.Semicolon:
				return voidType();
			default:
				console.log(chalk.yellow(`Cannot infer type from initializer of type: ${initializer.type}`));
				return null; // Cannot infer type
		}
	}

	private evaluateTypeOfBinaryExpression(node: BinaryExpression): ASTTypeRef {
		const overloadResult = this.getMethodForOverloadedBinaryExpression(node);
		if (overloadResult.failedToEvaluateType) return null;
		if (overloadResult.isOpOverload) return overloadResult.method.type.returnType;
		return this.inferTypeFrom(node.left);
	}

	private handleVariableDeclaration(varDecl: VariableDeclaration) {
		if (!this.currentContext) throw new Error(`Variable declarations must be inside a function context.`);

		const type = varDecl.variableType ?? this.inferTypeFrom(varDecl.initializer);
		if (type == null) throw new Error(`Cannot infer type for variable '${varDecl.name}', and no type was provided.`);

		this.builder.comment(`Variable declaration: '${varDecl.name}' type: ${typeToStr(type)}`);
		// this.currentContext.defineLocalVariable(varDecl.name, type);

		if (varDecl.arraySizeExpression) {
			if (type.type != ASTType.WrappedTypeRef) {
				throw new Error(`Array size expression provided for non-pointer type '${typeToStr(type)}'.`);
			}
			this.builder.comment(`Array size expression for ${varDecl.name}`);
			this.compileAst(varDecl.arraySizeExpression);
			this.builder.pop(reg(Register.r0));
			this.builder.mul(reg(Register.r0), imm(this.resolveTypeSize(type.inner)), reg(Register.r0)); // Multiply by the size of the type
			this.builder.malloc(reg(Register.r0), reg(Register.r1));
			this.currentContext.setVarFromRegister(varDecl.name, Register.r1); // Set the array to point to the allocated memory
		}

		if (varDecl.initializer.type == ASTType.Initializer) {
			varDecl.initializer.values.forEach((initer, index) => {
				if (initer.type == ASTType.StructFieldInitializer) {
					this.compileAst(initer.expression);
					this.builder.pop(reg(Register.r0));
					if (type.type != ASTType.RawTypeRef) throw new Error(`Struct field initializer is only supported for raw type references.`);
					const structType = type.rawType;
					const offset = this.getOffsetOfSimpleStructField(structType, initer.name);
					this.currentContext.setVarFromRegister(varDecl.name, Register.r0, offset);
				} else {
					if (type.type != ASTType.WrappedTypeRef) throw new Error(`Array initializer provided for non-pointer type '${typeToStr(type)}'.`);

					const offset = index * this.resolveTypeSize(type.inner);
					this.builder.comment(`Array init for ${varDecl.name}[${index}] at offset ${offset}`);
					this.compileAst(initer);
					this.currentContext.useVariableAsPointerAndSetFromStack(varDecl.name, offset, 1); // Use the pointer to the array and set the value from the stack
					// this.builder.pop(reg(Register.r0));
					// this.currentContext.setVarFromRegister(varDecl.name, Register.r0, index);
				}
			});
		} else {
			const expressionType = this.inferTypeFrom(varDecl.initializer);
			if (expressionType == null) {
				console.log(
					chalk.yellow(`Could not infer type for variable declaration initializer: ${varDecl.name}, expression type unknown: ${varDecl.initializer.type}`)
				);
			} else {
				if (!this.areTypesEqual(expressionType, type)) {
					console.log(
						chalk.yellow(
							`Type mismatch in variable declaration: variable '${varDecl.name}' type '${typeToStr(type)}' != initializer expression type '${typeToStr(expressionType)}'`
						)
					);
				}
			}
			this.compileAst(varDecl.initializer);
			this.currentContext.writeVarFromStack(varDecl.name);
		}
	}

	private getOffsetOfSimpleStructField(structType: string, fieldName: string): number {
		const struct = this.structs.get(structType);
		if (!struct) throw new Error(`Struct type '${structType}' is not defined.`);
		const field = struct.fields.get(fieldName);
		if (!field) throw new Error(`Struct type '${structType}' does not have a field named '${fieldName}'.`);

		const fieldSize = this.resolveTypeSize(field.type);
		if (fieldSize > 1) throw new Error(`Struct field '${fieldName}' of struct type '${structType}' is not a simple type, cannot get offset.`);

		return field.offset;
	}

	private handleReturnStatement(node: ReturnStatement) {
		this.builder.comment(`Return`);
		this.compileAst(node.expression);
		this.builder.jump(label(this.currentContext.outLabel));
	}

	private handleOutStatement(node: OutStatement) {
		this.builder.comment(`Out statement`);
		this.compileAst(node.expression);
		this.builder.pop(reg(Register.r0));
		this.builder.out(reg(Register.r0));
	}

	public areTypesEqual(typeA: ASTTypeRef, typeB: ASTTypeRef, ignoreFnReturnType = false): boolean {
		if (typeA == null || typeB == null) return typeA == typeB;
		if (typeA.type != typeB.type) return false;

		if (typeA.type == ASTType.RawTypeRef && typeB.type == ASTType.RawTypeRef) {
			return typeA.rawType == typeB.rawType;
		}

		if (typeA.type == ASTType.WrappedTypeRef && typeB.type == ASTType.WrappedTypeRef) {
			return this.areTypesEqual(typeA.inner, typeB.inner);
		}

		if (typeA.type == ASTType.FunctionTypeRef && typeB.type == ASTType.FunctionTypeRef) {
			if (typeA.parameters.length != typeB.parameters.length) return false;
			if (!typeA.parameters.every((param, index) => this.areTypesEqual(param, typeB.parameters[index]))) return false;
			if (!ignoreFnReturnType) return this.areTypesEqual(typeA.returnType, typeB.returnType);
			return true;
		}

		return false;
	}

	private isEffectivelyIntType(type: ASTTypeRef): boolean {
		if (type.type != ASTType.RawTypeRef) return false;
		if (type.rawType == "int" || type.rawType == "char" || type.rawType == "bool") return true;

		if (this.enums.has(type.rawType)) return true; // Enums are effectively ints

		return false;
	}

	private handleTopLevelFunctionDeclaration(node: FunctionDeclaration) {
		const funcCtx = this.handleFunctionDeclaration(node);

		if (!this.functions.has(node.name)) this.functions.set(node.name, []);
		const existingTypeSig = this.functions.get(node.name).find(f => this.areTypesEqual(f.type, funcCtx.type, true));
		if (existingTypeSig) throw new Error(`Function '${node.name}' with the same type signature already exists.`);

		this.functions.get(node.name).push(funcCtx);
	}

	public handleFunctionDeclaration(node: FunctionDeclaration): FunctionContext {
		if (this.currentContext != null) throw new Error(`Nested function declarations are not supported.`);

		const argSize = node.parameters.reduce((acc, param) => acc + this.resolveTypeSize(param.type), 0);
		const funcCtx = new FunctionContext(this, node);
		this.currentContext = funcCtx;

		if (node.name != "main") {
			this.builder.comment(`Save and setup fp`);
			this.builder.push(reg(Register.fp));
			this.builder.move(reg(Register.sp), reg(Register.fp));
		}

		// Stack grows upwards, our arguments should be 'below' the current fp
		// retAddr | arg0 | arg1 | returnPc | returnFp | ...
		// Fp is pointed at returnFp+1                  fp^
		// retAddr = fp (base) - argSize (arguments) - 1 (returnPc) - 1 (returnFp)

		// Points to the location of the next argument
		let argStackOffset = -argSize - 2;

		funcCtx.setupTypeInformation();

		const returnSize = this.resolveTypeSize(node.returnType);

		// There will be a return address as the first argument
		if (returnSize > 1) {
			funcCtx.defineArgumentVariable("__returnPointer", ptrOf(funcCtx.type.returnType), argStackOffset - 1);
		}

		// this.builder.commentln(`Arg setup fn "${node.name}":`);
		node.parameters.forEach(param => {
			funcCtx.defineArgumentVariable(param.name, param.type, argStackOffset);
			argStackOffset += this.resolveTypeSize(param.type);
		});

		this.builder.commentln(`Function body fn "${node.name}":`);
		node.body.forEach(statement => this.compileAst(statement));

		// Skip function epilogue
		if (node.name == "main") {
			this.currentContext = null;
			return funcCtx;
		}

		this.builder.addLabel(funcCtx.outLabel);
		this.builder.commentln(`Function epilogue fn "${node.name}":`);
		// Copy return value to wherever the caller expects it
		if (returnSize > 1) {
			funcCtx.readVarToRegister("__returnPointer", Register.r0);
			for (let i = 0; i < returnSize; i++) {
				this.builder.move(memReg(Register.sp, -returnSize + i), memReg(Register.r0, i));
			}
		} else {
			this.builder.pop(reg(Register.funcRet));
		}

		this.builder.comment(`Restore sp`);
		this.builder.move(reg(Register.fp), reg(Register.sp));
		this.builder.comment(`Restore fp`);
		this.builder.pop(reg(Register.fp));

		this.builder.comment(`Return`);
		this.builder.pop(reg(Register.pc));

		this.currentContext = null;
		return funcCtx;
	}

	private tryResolvingFunctionWithSimpleName(call: FunctionCall): FunctionContext {
		const funcDecls = this.functions.get(call.reference.identifier);
		if (funcDecls == null) return null;
		if (funcDecls.length == 1) return funcDecls[0];

		const fnCallType: FunctionTypeRef = {
			type: ASTType.FunctionTypeRef,
			parameters: call.arguments.map(arg => this.inferTypeFrom(arg)),
			returnType: null // Unknown
		};

		if (fnCallType.parameters.some(param => param == null))
			throw new Error(`Cannot infer types for all parameters of function call to ${call.reference.identifier}.`);

		const matchingFunc = funcDecls.find(f => this.areTypesEqual(f.type, fnCallType, true));
		if (!matchingFunc) {
			throw new Error(
				`No matching function found for call to ${call.reference.identifier} with parameter types (${fnCallType.parameters.map(p => typeToStr(p)).join(", ")}).`
			);
		}

		return matchingFunc;
	}

	private getReturnTypeForCall(call: FunctionCall): ASTTypeRef {
		if (call.reference.offsetExpressions == null && !call.reference.child) {
			const builtin = builtInFunctions.find(b => b.name == call.reference.identifier);
			if (builtin) return builtin.returnType;

			// const funcDecls = this.functions.get(call.reference.identifier);
			// if (funcDecls != null) {
			// 	return funcDecl.type.returnType;
			// }
			const funcDecl = this.tryResolvingFunctionWithSimpleName(call);
			if (funcDecl) return funcDecl.type.returnType;

			if (this.currentContext.isDefined(call.reference.identifier)) {
				const callInfo = this.currentContext.createCallInfoForLocal(call.reference.identifier);
				return callInfo.returnType;
			}

			throw new Error(`Attempt to call ${call.reference.identifier} which is not defined`);
		}

		const fnType = this.getFinalTypeOfReference(call.reference).type;
		if (fnType.type !== ASTType.FunctionTypeRef)
			throw new Error(`Attempt to call a non-function type '${typeToStr(fnType)}' for reference '${referenceToString(call.reference)}'.`);

		return fnType.returnType;
	}

	private handleFunctionCall(node: FunctionCall) {
		// First attempt to resolve using a simple concrete function name
		if (node.reference.offsetExpressions == null && !node.reference.child) {
			const builtin = builtInFunctions.find(b => b.name == node.reference.identifier);
			if (builtin) {
				this.callBuiltInFunction(builtin, node);
				return;
			}

			const funcDecls = this.functions.get(node.reference.identifier);
			if (funcDecls != null) {
				const argumentList = node.arguments.map(arg => this.inferTypeFrom(arg));
				const matchingFunc = this.findFunctionMatchingArgumentList(funcDecls, argumentList);
				this.callFunction(matchingFunc.name, matchingFunc.getCallInfo(), node);
				return;
			}

			if (this.currentContext.isDefined(node.reference.identifier)) {
				const callInfo = this.currentContext.createCallInfoForLocal(node.reference.identifier);
				this.callFunction(node.reference.identifier, callInfo, node);
				return;
			}

			throw new Error(`Attempt to call ${node.reference.identifier} which is not defined`);
		} else {
			if (this.structs.has(node.reference.identifier)) {
				const structDecl = this.structs.get(node.reference.identifier);
				if (!structDecl.methods.has(node.reference.child.identifier))
					throw new Error(`Struct type '${node.reference.identifier}' does not have a method named '${node.reference.child.identifier}'.`);

				const fnList = structDecl.methods.get(node.reference.child.identifier);
				if (fnList == null)
					throw new Error(`Struct type '${node.reference.identifier}' does not have a method named '${node.reference.child.identifier}'.`);
				if (fnList.length > 1)
					throw new Error(
						`Static method cannot be overloaded, struct type '${node.reference.identifier}' has multiple methods named '${node.reference.child.identifier}'.`
					);

				const fn = fnList[0];
				if (!fn.isStatic)
					throw new Error(
						`Static method expected, but method '${node.reference.child.identifier}' of struct type '${node.reference.identifier}' is not static.`
					);

				this.callFunction(`${node.reference.identifier}_${node.reference.child.identifier}`, fn.getCallInfo(), node);
				return;
			}

			this.callFunctionViaComplexReference(node);
		}
	}

	private deleteRefsFinalChild(node: Reference) {
		let cur = node;
		while (cur.child) {
			if (!cur.child.child) {
				const finalChild = cur.child;
				cur.child = null;
				return finalChild;
			}

			cur = cur.child;
		}
	}

	private findFunctionMatchingArgumentList(functions: FunctionContext[], argumentTypes: ASTTypeRef[]): FunctionContext {
		if (functions.length == 0) throw new Error(`No functions provided to match argument list.`);
		if (functions.length == 1) return functions[0];

		if (argumentTypes.some(argType => argType == null)) throw new Error(`Cannot infer all argument types for function call, cannot resolve overloads.`);

		const expectedFnType: FunctionTypeRef = {
			type: ASTType.FunctionTypeRef,
			parameters: argumentTypes,
			returnType: null // Unknown
		};

		const matchingFunc = functions.find(f => this.areTypesEqual(f.type, expectedFnType, true));
		if (!matchingFunc) throw new Error(`No matching function found for argument types (${argumentTypes.map(t => typeToStr(t)).join(", ")})`);

		return matchingFunc;
	}

	private callFunctionViaComplexReference(call: FunctionCall) {
		const { type, isMethod, methodStructDecl } = this.getFinalTypeOfReference(call.reference);
		if (type.type !== ASTType.FunctionTypeRef)
			throw new Error(`Attempt to call a non-function type '${typeToStr(type)}' for reference '${referenceToString(call.reference)}'.`);

		if (isMethod) {
			// Remove the function name from reference chain
			const methodName = this.deleteRefsFinalChild(call.reference);
			this.callMethod(methodStructDecl, methodName.identifier, call);
			return;
		}

		const argumentSize = type.parameters.reduce((acc, param) => acc + this.resolveTypeSize(param), 0);
		const returnSize = this.resolveTypeSize(type.returnType);
		let returnVarName: string;
		if (returnSize > 1) {
			// Have to create a return variable and pass a pointer to it for the return function
			returnVarName = `__dynCall_return_${id++}`;
			this.currentContext.defineLocalVariable(returnVarName, type.returnType, false);
			this.currentContext.pushAddressOfLocal(returnVarName); // Return address will be arg0
		}

		this.builder.comment(`Function call with complex reference: ${referenceToString(call.reference)} of type ${typeToStr(type)}`);
		this.resolveComplexReferenceAddressInR0(call.reference);
		this.builder.comment(`Push function ptr`);
		this.builder.push(memReg(Register.r0)); // This will be at sp-argSize-1 after we evaluate args

		this.builder.comment(`Evaluating arguments for call ${referenceToString(call.reference)}`);
		call.arguments.forEach(arg => this.compileAst(arg));

		this.builder.comment(`Push return address`);
		this.builder.add(reg(Register.pc), imm(2), reg(Register.r0));
		this.builder.push(reg(Register.r0));

		this.builder.comment(`Jump (complex)`);
		this.builder.move(memReg(Register.sp, -argumentSize - 2), reg(Register.pc));

		this.builder.comment(`Clean up stack after call to ${referenceToString(call.reference)}`);
		// +1 to account for the return address we pushed
		this.builder.sub(reg(Register.sp), imm(argumentSize + 1), reg(Register.sp));

		if (returnSize == 1) this.builder.push(reg(Register.funcRet));
		else if (returnSize > 1) this.currentContext.readVarToStack(returnVarName);
	}

	private callMethod(struct: Struct, methodName: string, call: FunctionCall) {
		const methods = struct.methods.get(methodName);
		const debugName = `${struct.name}_${methodName}`;
		this.builder.comment(`Calling method ${debugName}`);

		const argumentList = call.arguments.map(arg => this.inferTypeFrom(arg));
		argumentList.unshift(ptrOf({ type: ASTType.RawTypeRef, rawType: struct.name })); // Add this pointer as first argument
		const matchingMethod = this.findFunctionMatchingArgumentList(methods, argumentList);

		this.callFunction(debugName, matchingMethod.getCallInfo(), call, call.reference);
	}

	// Name is only for debug info/symbols
	private callFunction(name: string, funcInfo: FunctionCallInfo, call: FunctionCall, thisArgRef: Reference = null) {
		this.builder.commentln(`Calling ${name}`);

		const returnSize = this.resolveTypeSize(funcInfo.returnType);
		let returnVarName: string;
		if (returnSize > 1) {
			// Have to create a return variable and pass a pointer to it for the return function
			returnVarName = `__${name}_return_${id++}`;
			this.currentContext.defineLocalVariable(returnVarName, funcInfo.returnType, false);
			this.currentContext.pushAddressOfLocal(returnVarName); // Return address will be arg0
		}

		this.builder.comment(`Evaluating arguments for call ${name}`);
		let argumentSize = funcInfo.argumentSize;
		if (thisArgRef) {
			this.builder.comment(`Evaluating thisArg for method call ${name}`);
			this.handleReferenceRead(thisArgRef, true); // Push a thisarg pointer
		}
		call.arguments.forEach(arg => this.compileAst(arg));

		const argumentCount = thisArgRef ? call.arguments.length + 1 : call.arguments.length;
		if (argumentCount != funcInfo.argumentCount) {
			throw new Error(`Function ${name} expects ${funcInfo.argumentCount} arguments, but got ${argumentCount}.`);
		}

		this.builder.comment(`Push return address`);
		this.builder.add(reg(Register.pc), imm(2 + funcInfo.addressExtraInstructionCount), reg(Register.r0));
		this.builder.push(reg(Register.r0));

		this.builder.comment(`Jump`);
		this.builder.move(funcInfo.getAddress(), reg(Register.pc));

		// Move stack back to pre-argument position
		this.builder.comment(`Clean up stack after call to ${name}`);
		this.builder.sub(reg(Register.sp), imm(argumentSize), reg(Register.sp));

		// If the function returns a single value, we store it in funcRet register
		// Push that value onto stack so whatever expression is expecting it may use it
		if (returnSize == 1) this.builder.push(reg(Register.funcRet));
		else if (returnSize > 1) this.currentContext.readVarToStack(returnVarName);
	}

	private callBuiltInFunction(builtin: BuiltInFunction, call: FunctionCall) {
		const returnSize = this.resolveTypeSize(builtin.returnType);
		let returnVarName: string;
		if (returnSize > 1) {
			// Have to create a return variable and pass a pointer to it for the return function
			returnVarName = `__${builtin.name}_return_${id++}`;
			this.currentContext.defineLocalVariable(returnVarName, builtin.returnType, false);
			this.currentContext.pushAddressOfLocal(returnVarName); // Return address will be arg0
		}

		this.builder.comment(`Calling built-in function ${builtin.name}`);
		builtin.handleCall.call(this, call);

		if (returnSize == 1) this.builder.push(reg(Register.funcRet));
		else if (returnSize > 1) this.currentContext.readVarToStack(returnVarName);
	}
}

export { Compiler, FunctionCallInfo, typeToStr, referenceToString, primitiveSizeMap };
