import {
	AST,
	ASTType,
	ASTTypeRef,
	BinaryExpression,
	FunctionCall,
	FunctionDeclaration,
	Literal,
	OutStatement,
	Program,
	RawTypeRef,
	Reference,
	ReturnStatement,
	StructDeclaration,
	VariableDeclaration
} from "../parser/ast.js";
import { imm, INT_SIZE, IRArgument, IRBuilder, memReg, reg, Register, str } from "./ir.js";

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
		} else {
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

		if (current.dereferenceForChild) result += "->";
		else if (current.child) result += ".";

		if (!current.child) break;
		current = current.child;
	}

	return result;
}

class FunctionContext {
	// public address: number;
	public name: string;

	private locals: Map<string, { type: ASTTypeRef; stackOffset: number; size: number }> = new Map();
	private currentStackOffset: number = 0;

	private builder: IRBuilder;

	constructor(
		private compiler: Compiler,
		name: string
	) {
		this.name = name;
		this.builder = this.compiler.builder;

		this.builder.addLabel(this.name);
	}

	public defineLocalVariable(name: string, type: ASTTypeRef) {
		if (this.locals.has(name)) throw new Error(`Local variable '${name}' is already defined in function '${this.name}'.`);
		const size = this.compiler.resolveTypeSize(type);
		this.locals.set(name, { type, stackOffset: this.currentStackOffset, size });
		this.currentStackOffset += size;

		this.builder.comment(`Local ${name} (${typeToStr(type)}) at ${this.currentStackOffset - size} (size ${size})`);
		this.builder.add(reg(Register.sp), imm(size), reg(Register.sp)); // Allocate space on stack for local variable
	}

	// Reads variable 'name' onto the stack
	// offset is used for reading a specific element of a struct
	// if offset is provided must provide a size otherwise the read will overflow the structs bounds
	public readVarToStack(name: string, offset: number, size: number): void;
	public readVarToStack(name: string): void;
	public readVarToStack(name: string, offset = 0, size = -1): void {
		if (!this.locals.has(name)) throw new Error(`Local variable '${name}' is not defined in function '${this.name}'.`);

		const local = this.locals.get(name);
		const readSize = size == -1 ? local.size : size;
		// Imagine operation 'read struct Test {a,b} to stack'
		//             Struct offset for Test is 2, struct is at fp+2
		//              V
		// Stack [x, x, a, b, x, x, x, _, _, _]
		//     fp ^                 sp ^
		// Stack end state:
		// Stack [x, x, a, b, x, x, x, a, b, _]
		//     fp ^                       sp ^
		// NOTE: If we want to then copy the struct off the stack via poping, we need to understand that
		//       the struct will be in reverse order
		for (let i = 0; i < readSize; i++) {
			this.builder.add(reg(Register.fp), imm(local.stackOffset + i + offset), reg(Register.offset));
			this.builder.push(memReg(Register.offset));
		}
	}

	public writeVarFromStack(name: string) {
		if (!this.locals.has(name)) throw new Error(`Local variable '${name}' is not defined in function '${this.name}'.`);

		const local = this.locals.get(name);
		// Reversed order of readVarToStack, as we want to pop the values off the stack in reverse order
		for (let i = local.size - 1; i >= 0; i--) {
			this.builder.add(reg(Register.fp), imm(local.stackOffset + i), reg(Register.offset));
			this.builder.pop(memReg(Register.offset));
		}
	}

	public readVarToRegister(name: string, register: Register) {
		if (!this.locals.has(name)) throw new Error(`Local variable '${name}' is not defined in function '${this.name}'.`);
		const local = this.locals.get(name);
		if (local.size > 1) throw new Error(`Reading local variable '${name}' to register is only supported for single-cell types.`);

		this.builder.add(reg(Register.fp), imm(local.stackOffset), reg(Register.offset));
		this.builder.move(memReg(Register.offset), reg(register));
	}

	public moveAddressOfLocalToRegister(name: string, register: Register) {
		this.builder.add(reg(Register.fp), imm(this.locals.get(name).stackOffset), reg(register));
	}

	public setVarFromRegister(name: string, register: Register, offset = 0) {
		if (register == Register.offset) throw new Error(`Cannot set variable '${name}' from offset register, offset register is overwritten in operation.`);
		if (!this.locals.has(name)) throw new Error(`Local variable '${name}' is not defined in function '${this.name}'.`);

		const local = this.locals.get(name);
		// if (local.size > 1) throw new Error(`Setting local variable '${name}' from register is only supported for single-cell types.`);

		this.builder.add(reg(Register.fp), imm(local.stackOffset + offset), reg(Register.offset));
		this.builder.move(reg(register), memReg(Register.offset));
	}

	public getTypeOfLocal(name: string): ASTTypeRef {
		if (!this.locals.has(name)) throw new Error(`Local variable '${name}' is not defined in function '${this.name}'.`);
		return this.locals.get(name).type;
	}

	// Ensures the current frame has enough space to allow the return value to be written to the top of the stack
	// We don't have to allocate any space that we already have, as when we return it is OK to overwrite the stack space
	// used for local variables, as they are no longer needed
	public saveSpaceForReturnOfSize(size: number) {
		const extraSpaceToAllocate = Math.max(0, this.currentStackOffset - size);
		if (extraSpaceToAllocate > 0) {
			this.builder.add(reg(Register.sp), imm(extraSpaceToAllocate), reg(Register.sp)); // Allocate space on stack for return value
			this.currentStackOffset += extraSpaceToAllocate;
		}
	}
}

class Struct {
	public name: string;
	public fields: Map<string, { type: ASTTypeRef; offset: number }> = new Map();
	public methods: Map<string, FunctionContext> = new Map();
	public size: number = 0;

	constructor(
		private compiler: Compiler,
		private def: StructDeclaration
	) {
		this.name = def.name;
		def.fields.forEach(field => {
			const size = this.compiler.resolveTypeSize(field.type);
			this.fields.set(field.name, { type: field.type, offset: this.size });
			this.size += size;
		});
	}

	public buildMethods() {
		this.def.methods.forEach(method => {
			const funcCtx = this.compiler.handleFunctionDeclaration(method);
			this.methods.set(method.name, funcCtx);
		});
	}
}

class Compiler {
	private currentContext: FunctionContext = null;
	public builder: IRBuilder = new IRBuilder();
	private structs: Map<string, Struct> = new Map();
	private functions: Map<string, FunctionContext> = new Map();

	constructor(private program: Program) {}

	public compile() {
		this.program.body.forEach(node => {
			this.compileAst(node);
		});

		this.builder.halt();
		return this.builder.getCode();
	}

	public resolveTypeSize(type: ASTTypeRef) {
		if (type.type === ASTType.WrappedTypeRef) return INT_SIZE;

		switch (type.rawType) {
			case "int":
				return INT_SIZE;
			case "void":
				return 0;
			default:
				if (this.structs.has(type.rawType)) {
					const struct = this.structs.get(type.rawType);
					return struct.size;
				}
				throw new Error(`Unsupported type: ${type.rawType}`);
		}
	}

	private compileAst(node: AST) {
		switch (node.type) {
			case ASTType.FunctionDeclaration:
				this.handleFunctionDeclaration(node);
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
				this.handleReference(node);
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
				this.handleReference(node.reference, true);
				break;
			case ASTType.Out:
				this.handleOutStatement(node);
				break;
			default:
				throw new Error(`Unsupported AST node type: ${node.type}`);
		}
	}

	// AddressOf prevents the final dereference we will do
	private handleReference(node: Reference, addressOf = false) {
		if (!this.currentContext) throw new Error(`Unexpected reference outside of a function context.`);
		this.builder.comment(`Reference: ${referenceToString(node)}${addressOf ? " (addressOf)" : ""}`);

		// Yay! Very simple reference type, direct stack access that we should have in local ctx
		if (!addressOf && !node.child && node.offsetExpressions == null) {
			this.builder.comment(`Simple reference to local variable: ${node.identifier}`);
			this.currentContext.readVarToStack(node.identifier);
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

		let curRef = node;
		let currentType = this.currentContext.getTypeOfLocal(curRef.identifier);

		// Set r0 to pointer to the base of the reference
		this.currentContext.moveAddressOfLocalToRegister(curRef.identifier, Register.r0);
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
					currentType = currentType.inner;

					this.builder.push(reg(Register.r0));
					this.compileAst(offsetExpr);
					this.builder.pop(reg(Register.r1)); // Result of the offset expression
					this.builder.pop(reg(Register.r0)); // Restore r0 to the current pointer
					this.builder.add(reg(Register.r0), reg(Register.r1), reg(Register.r0)); // Add the offset to the pointer
				});
			}

			// Attempting to access a struct field, but the struct ref is a pointer
			// Implements the -> notation
			// Must be done after offset (array) expressions
			if (curRef.dereferenceForChild) {
				if (currentType.type != ASTType.WrappedTypeRef)
					throw new Error(`Attempt to dereference a non-pointer type '${typeToStr(currentType)}' for reference '${curRef.identifier}'.`);

				this.builder.move(memReg(Register.r0), reg(Register.r0)); // Dereference r0 to get the pointer to the next level
				currentType = currentType.inner;
			}

			if (!curRef.child) break;
			curRef = curRef.child;
		}

		// r0 should now finally point to our data
		if (addressOf) {
			this.builder.push(reg(Register.r0));
			return;
		}

		const finalTypeSize = this.resolveTypeSize(currentType);
		for (let i = 0; i < finalTypeSize; i++) {
			this.builder.add(reg(Register.r0), imm(i), reg(Register.offset));
			this.builder.push(memReg(Register.offset));
		}
	}

	// Attempts to resolve the offset of a reference for simple absolute struct accesses
	// If the reference requires derefs, returns -1
	private getReferenceOffsetWithoutDerefs(node: Reference) {
		let curRef = node;
		let offset = 0;
		let currentType: ASTTypeRef = null;

		while (true) {
			if (curRef.offsetExpressions != null || curRef.dereferenceForChild) return { offset: -1, readType: null };

			if (!curRef.child) return { offset, readType: currentType };

			if (currentType == null) {
				const varType = this.currentContext.getTypeOfLocal(curRef.identifier);
				currentType = varType;
			}

			if (currentType.type == ASTType.WrappedTypeRef) {
				throw new Error(`Attempt to access field '${curRef.child.identifier}' of a wrapped type reference '${curRef.identifier}', must dereference.`);
			}

			const structDef = this.structs.get(currentType.rawType);
			if (!structDef) throw new Error(`Attempt to access field '${curRef.child.identifier}' of a non-struct type '${currentType.rawType}'.`);

			const field = structDef.fields.get(curRef.child.identifier);
			if (!field) throw new Error(`Struct type '${currentType.rawType}' does not have a field named '${curRef.child.identifier}'.`);

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
				this.builder.push(str(node.value));
				break;
			default:
				throw new Error(`Unsupported literal type: ${node.literalType}`);
		}
	}

	private handleBinaryExpression(node: BinaryExpression) {
		this.compileAst(node.left);
		this.compileAst(node.right);
		this.builder.pop(reg(Register.r1));
		this.builder.pop(reg(Register.r0));

		switch (node.operator) {
			case "+":
				this.builder.add(reg(Register.r0), reg(Register.r1), memReg(Register.sp));
				this.builder.incSp();
				break;
			case "-":
				this.builder.sub(reg(Register.r0), reg(Register.r1), memReg(Register.sp));
				this.builder.incSp();
				break;
			case "*":
				this.builder.mul(reg(Register.r0), reg(Register.r1), memReg(Register.sp));
				this.builder.incSp();
				break;
			case "/":
				this.builder.div(reg(Register.r0), reg(Register.r1), memReg(Register.sp));
				this.builder.incSp();
				break;
			default:
				throw new Error(`Unsupported binary operator: ${node.operator}`);
		}
	}

	private handleStructDeclaration(node: StructDeclaration) {
		const struct = new Struct(this, node);
		this.structs.set(node.name, struct);

		// Only build method after the struct is fully defined, so that methods can reference the struct's fields if needed
		struct.buildMethods();
	}

	private handleVariableDeclaration(varDecl: VariableDeclaration) {
		if (!this.currentContext) throw new Error(`Variable declarations must be inside a function context.`);
		this.currentContext.defineLocalVariable(varDecl.name, varDecl.variableType);

		if (varDecl.arraySizeExpression) {
			this.compileAst(varDecl.arraySizeExpression);
			this.builder.pop(reg(Register.r0));
			this.builder.malloc(reg(Register.r0), reg(Register.r1));
			this.currentContext.setVarFromRegister(varDecl.name, Register.r1); // Set the array to point to the allocated memory
		}

		if (varDecl.initializer.type == ASTType.Initializer) {
			varDecl.initializer.values.forEach((initer, index) => {
				if (initer.type == ASTType.StructFieldInitializer) {
					this.compileAst(initer.expression);
					this.builder.pop(reg(Register.r0));
					if (varDecl.variableType.type != ASTType.RawTypeRef) throw new Error(`Struct field initializer is only supported for raw type references.`);
					const structType = varDecl.variableType.rawType;
					const offset = this.getOffsetOfSimpleStructField(structType, initer.name);
					this.currentContext.setVarFromRegister(varDecl.name, Register.r0, offset);
				} else {
					this.compileAst(initer);
					this.builder.pop(reg(Register.r0));
					this.currentContext.setVarFromRegister(varDecl.name, Register.r0, index);
				}
			});
		} else {
			this.compileAst(varDecl.initializer);
			this.builder.pop(reg(Register.r0));
			this.currentContext.setVarFromRegister(varDecl.name, Register.r0);
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
	}

	private handleOutStatement(node: OutStatement) {
		this.builder.comment(`Out statement`);
		this.compileAst(node.expression);
		this.builder.pop(reg(Register.r0));
		this.builder.out(reg(Register.r0));
	}

	public handleFunctionDeclaration(node: FunctionDeclaration): FunctionContext {
		if (this.currentContext != null) throw new Error(`Nested function declarations are not supported.`);

		const funcCtx = new FunctionContext(this, node.name, this.builder.currentAddress);
		this.functions.set(node.name, funcCtx);
		this.currentContext = funcCtx;
		this.builder.commentln(`Arg setup fn "${node.name}":`);

		node.parameters.forEach(param => funcCtx.defineLocalVariable(param.name, param.type));

		// Define space for our special variables, first save some space
		const returnSize = this.resolveTypeSize(node.returnType);
		funcCtx.saveSpaceForReturnOfSize(returnSize);
		funcCtx.defineLocalVariable("__returnAddress", { type: ASTType.RawTypeRef, rawType: "int" });
		funcCtx.defineLocalVariable("__savedFP", { type: ASTType.RawTypeRef, rawType: "int" });

		this.builder.commentln(`Function body fn "${node.name}":`);
		node.body.forEach(statement => this.compileAst(statement));

		// Skip function epilogue
		if (node.name == "main") {
			this.currentContext = null;
			this.builder.setEntryPoint(funcCtx.address);
			return funcCtx;
		}

		this.builder.commentln(`Function epilogue fn "${node.name}":`);
		// Copy return value to the top of the stack, so that the caller can pop it off
		for (let i = 0; i < returnSize; i++) {
			this.builder.add(reg(Register.sp), imm(-returnSize + i), reg(Register.offset));
			this.builder.add(reg(Register.fp), imm(i), reg(Register.r0));
			this.builder.move(memReg(Register.offset), memReg(Register.r0));
		}
		// Set sp to top of that return value
		this.builder.add(reg(Register.fp), imm(returnSize), reg(Register.sp));

		funcCtx.readVarToRegister("__returnAddress", Register.r0);
		funcCtx.readVarToRegister("__savedFP", Register.fp); // Restore fp
		this.builder.move(reg(Register.r0), reg(Register.pc)); // Return to caller

		this.currentContext = null;
		return funcCtx;
	}

	private handleFunctionCall(node: FunctionCall) {
		// First attempt to resolve using a simple concrete function name
		if (node.reference.offsetExpressions == null && !node.reference.child) {
			const funcDecl = this.functions.get(node.reference.identifier);
			if (!funcDecl) throw new Error(`Function '${node.reference.identifier}' is not defined.`);

			this.builder.commentln(`Evaluating arguments for call ${node.reference.identifier}`);
			node.arguments.forEach(arg => this.compileAst(arg));
			this.callFunction(imm(funcDecl.address));
			return;
		}
	}

	private callFunction(address: IRArgument) {
		const INSTRUCTIONS_BEFORE_CALL = 3; // The number of instructions before the call that we need to account for when calculating the return address
		this.builder.commentln(`Calling ${address}`);
		this.builder.add(reg(Register.pc), imm(INSTRUCTIONS_BEFORE_CALL), reg(Register.offset));
		this.builder.incSp();
		this.builder.push(reg(Register.fp));
		this.builder.move(address, reg(Register.pc));
	}
}

export { Compiler };
