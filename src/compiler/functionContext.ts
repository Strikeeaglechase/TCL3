import chalk from "chalk";

import { Register } from "../ir/ir.js";
import { imm, IRBuilder, label, memReg, reg } from "../ir/irBuilder.js";
import { ASTType, ASTTypeRef, FunctionDeclaration, FunctionTypeRef, ReturnStatement, VariableDeclaration } from "../parser/ast.js";
import { walk } from "../parser/walker.js";
import { Compiler, FunctionCallInfo, typeToStr } from "./compiler.js";

interface Local {
	type: ASTTypeRef;
	stackOffset: number;
	size: number;
}

let id = 0;
class FunctionContext {
	public name: string;
	public type: FunctionTypeRef;
	public get callTypeSignature(): string {
		return this.type.parameters.map(param => typeToStr(param)).join(", ");
	}
	public argSize: number;

	public outLabel: string = null;
	public label: string = null;

	private locals: Map<string, Local> = new Map();
	private forwardDeclaredParameters: Map<string, Omit<Local, "stackOffset">> = new Map();

	private currentStackOffset: number = 0;

	protected builder: IRBuilder;

	constructor(
		private compiler: Compiler,
		private func: FunctionDeclaration
		// name: string,
		// argSize: number,
		// returnType: ASTTypeRef
	) {
		this.name = func.name;
		const fnId = id++;
		this.label = this.name == "main" ? "main" : `${this.name}_${fnId}`;
		this.outLabel = `${this.name}_out_${fnId}`;
		this.argSize = func.parameters.reduce((acc, param) => acc + this.compiler.resolveTypeSize(param.type), 0);
		this.builder = this.compiler.builder;

		this.builder.addLabel(this.label);
	}

	private checkOrResolveReturnType() {
		const returns: ReturnStatement[] = [];
		walk(this.func, n => {
			if (n.type === ASTType.ReturnStatement) returns.push(n);
		});

		if (returns.length == 0) {
			if (this.func.returnType.type != ASTType.RawTypeRef || this.func.returnType.rawType != "void") {
				throw new Error(`Function '${this.name}' has no return statements, but has a declared return type of '${typeToStr(this.func.returnType)}'.`);
			}

			return;
		}

		const retTypes = returns.map(ret => this.compiler.inferTypeFrom(ret.expression));
		if (retTypes.some(t => t == null)) {
			console.log(chalk.yellow(`Function '${this.name}' has a return statement with an expression that could not be type checked.`));
			return;
		}

		const firstRetType = retTypes[0];
		if (this.func.returnType == null) {
			this.func.returnType = firstRetType;
		} else {
			if (!this.compiler.areTypesEqual(firstRetType, this.func.returnType)) {
				throw new Error(
					`Function '${this.name}' has a return statement with type '${typeToStr(firstRetType)}' that does not match the declared return type '${typeToStr(this.func.returnType)}'.`
				);
			}
		}

		const notMatchingType = retTypes.find(t => !this.compiler.areTypesEqual(t, this.func.returnType));
		if (notMatchingType) {
			throw new Error(
				`Function '${this.name}' has a return statement with type '${typeToStr(notMatchingType)}' that does not match the declared return type '${typeToStr(this.func.returnType)}'.`
			);
		}
	}

	// Forward declares variables, checks return types (and infers if doesn't exist), and establishes the function type
	public setupTypeInformation() {
		this.forwardDeclareVariables();
		this.checkOrResolveReturnType();
		this.establishType();
	}

	private establishType() {
		this.type = {
			type: ASTType.FunctionTypeRef,
			parameters: this.func.parameters.map(param => param.type),
			returnType: this.func.returnType
		};

		if (this.type.returnType == null) throw new Error(`Function '${this.name}' has a return type that could not be resolved.`);
		if (this.type.parameters.some(param => param == null)) throw new Error(`Function '${this.name}' has a parameter type that could not be resolved.`);
	}

	private forwardDeclareVariables() {
		// Add parameters as forward declared, however do not yet position them on the stack
		// Positioning must wait until we know the return type size, as we may have a return pointer as the very first argument
		this.func.parameters.forEach(param => {
			this.forwardDeclaredParameters.set(param.name, { type: param.type, size: this.compiler.resolveTypeSize(param.type) });
		});

		const varDecls: VariableDeclaration[] = [];
		walk(this.func, node => {
			if (node.type != ASTType.VariableDeclaration) return;

			// Concrete type, safe to immediately define
			if (node.variableType) {
				this.defineLocalVariable(node.name, node.variableType, true);
				return;
			}

			varDecls.push(node);
		});

		while (varDecls.length > 0) {
			const typeReady = varDecls.find(node => this.compiler.inferTypeFrom(node.initializer) != null);
			if (!typeReady) throw new Error(`Cannot infer type for local variable(s) in function '${this.name}': ${varDecls.map(v => v.name).join(", ")}`);
			this.defineLocalVariable(typeReady.name, this.compiler.inferTypeFrom(typeReady.initializer), true);
			varDecls.splice(varDecls.indexOf(typeReady), 1);
		}

		this.locals.forEach((local, name) => {
			this.builder.commentln(`Local ${name} (${typeToStr(local.type)}) at ${local.stackOffset} (size ${local.size})`);
		});
		this.builder.comment(`Stack reservation for ${this.name} (size ${this.currentStackOffset})`);
		this.builder.add(reg(Register.sp), imm(this.currentStackOffset), reg(Register.sp)); // Allocate space on stack for local variables
	}

	public defineLocalVariable(name: string, type: ASTTypeRef, preReservedStack: boolean) {
		if (this.locals.has(name)) throw new Error(`Local variable '${name}' is already defined in function '${this.name}'.`);
		const size = this.compiler.resolveTypeSize(type);
		this.locals.set(name, { type, stackOffset: this.currentStackOffset, size });
		this.currentStackOffset += size;

		if (!preReservedStack) {
			this.builder.comment(`Local ${name} (${typeToStr(type)}) at ${this.currentStackOffset - size} (size ${size})`);
			this.builder.add(reg(Register.sp), imm(size), reg(Register.sp)); // Allocate space on stack for local variable
		}
	}

	// A variable 'below' our fp
	public defineArgumentVariable(name: string, type: ASTTypeRef, stackOffset: number) {
		if (this.locals.has(name)) throw new Error(`Local variable '${name}' is already defined in function '${this.name}'.`);
		const size = this.compiler.resolveTypeSize(type);
		this.locals.set(name, { type, stackOffset, size });
	}

	// Reads variable 'name' onto the stack
	// offset is used for reading a specific element of a struct
	// if offset is provided must provide a size otherwise the read will overflow the structs bounds
	public readVarToStack(name: string, offset: number, size: number): void;
	public readVarToStack(name: string): void;
	public readVarToStack(name: string, offset = 0, size = -1): void {
		if (this.compiler.functions.has(name)) {
			if (offset !== 0 || size !== -1) throw new Error(`Cannot read function '${name}' with offset or size.`);
			const fns = this.compiler.functions.get(name);
			if (fns != null) {
				if (fns.length > 1) throw new Error(`Unable to take function pointer of function '${name}' due to being an overloaded function`);

				const fn = this.compiler.functions.get(name)[0];
				this.builder.push(label(fn.label));
				return;
			}
		}

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
			// this.builder.add(reg(Register.fp), imm(local.stackOffset + i + offset), reg(Register.offset));
			this.builder.push(memReg(Register.fp, local.stackOffset + i + offset));
		}
	}

	public writeVarFromStack(name: string, offset: number, size: number): void;
	public writeVarFromStack(name: string): void;
	public writeVarFromStack(name: string, offset = 0, size = -1): void {
		if (!this.locals.has(name)) throw new Error(`Local variable '${name}' is not defined in function '${this.name}'.`);

		const local = this.locals.get(name);
		const readSize = size == -1 ? local.size : size;

		// Reversed order of readVarToStack, as we want to pop the values off the stack in reverse order
		for (let i = readSize - 1; i >= 0; i--) {
			// this.builder.add(reg(Register.fp), imm(local.stackOffset + i), reg(Register.offset));
			this.builder.pop(memReg(Register.fp, local.stackOffset + i + offset));
		}
	}

	public readVarToRegister(name: string, register: Register) {
		if (!this.locals.has(name)) throw new Error(`Local variable '${name}' is not defined in function '${this.name}'.`);
		const local = this.locals.get(name);
		if (local.size > 1) throw new Error(`Reading local variable '${name}' to register is only supported for single-cell types.`);

		// this.builder.add(reg(Register.fp), imm(local.stackOffset), reg(Register.offset));
		this.builder.move(memReg(Register.fp, local.stackOffset), reg(register));
	}

	public getAddressOfLocalInRegister(name: string, register: Register) {
		this.builder.add(reg(Register.fp), imm(this.locals.get(name).stackOffset), reg(register));
	}

	public pushAddressOfLocal(name: string) {
		this.builder.add(reg(Register.fp), imm(this.locals.get(name).stackOffset), reg(Register.r0));
		this.builder.push(reg(Register.r0));
	}

	public setVarFromRegister(name: string, register: Register, offset: number = null) {
		if (!this.locals.has(name)) throw new Error(`Local variable '${name}' is not defined in function '${this.name}'.`);

		const local = this.locals.get(name);
		if (local.size > 1 && offset === null) throw new Error(`Setting local variable '${name}' from register is only supported for single-cell types.`);

		const inputOffset = offset !== null ? offset : 0;
		this.builder.move(reg(register), memReg(Register.fp, local.stackOffset + inputOffset));
	}

	public useVariableAsPointerAndSetFromStack(name: string, offset: number, dereferenceCount: number) {
		if (!this.locals.has(name)) throw new Error(`Local variable '${name}' is not defined in function '${this.name}'.`);

		const local = this.locals.get(name);
		let currentType = local.type;

		// Only do initial dereference if we have more than one dereference
		// We want to leave a pointer in r0 to write to, not the value itself
		if (dereferenceCount > 1) {
			if (currentType.type != ASTType.WrappedTypeRef)
				throw new Error(`Attempt to dereference a non-pointer variable '${name}' - type is '${typeToStr(local.type)}'`);
			currentType = currentType.inner;
			this.builder.move(memReg(Register.fp, local.stackOffset), reg(Register.r0));
		} else {
			// Ensure r0 still has the pointer if we're not doing an init dereference, as we want to write to the pointer itself
			this.builder.add(reg(Register.fp), imm(local.stackOffset), reg(Register.r0));
		}

		for (let d = 0; d < dereferenceCount - 2; d++) {
			if (currentType.type != ASTType.WrappedTypeRef)
				throw new Error(`Attempt to dereference a non-pointer variable '${name}' - type is '${typeToStr(local.type)}'`);
			currentType = currentType.inner;
			this.builder.move(memReg(Register.r0), reg(Register.r0)); // Deref for each level
		}

		if (currentType.type != ASTType.WrappedTypeRef)
			throw new Error(`Attempt to dereference a non-pointer variable '${name}' - type is '${typeToStr(local.type)}'`);

		const innerSize = this.compiler.resolveTypeSize(currentType.inner);

		for (let i = innerSize - 1; i >= 0; i--) {
			this.builder.add(memReg(Register.r0), imm(offset + i), reg(Register.r1));
			this.builder.pop(memReg(Register.r1));
		}
	}

	public useVariableAsPointerAndReadToStack(name: string, dereferenceCount: number) {
		if (!this.locals.has(name)) throw new Error(`Local variable '${name}' is not defined in function '${this.name}'.`);

		const local = this.locals.get(name);

		// First deref
		let currentType = local.type;
		if (currentType.type != ASTType.WrappedTypeRef)
			throw new Error(`Attempt to dereference a non-pointer variable '${name}' - type is '${typeToStr(local.type)}'`);
		currentType = currentType.inner;
		this.builder.move(memReg(Register.fp, local.stackOffset), reg(Register.r0));

		// Remaining derefs
		for (let d = 0; d < dereferenceCount - 1; d++) {
			if (currentType.type != ASTType.WrappedTypeRef)
				throw new Error(`Attempt to dereference a non-pointer variable '${name}' - type is '${typeToStr(local.type)}'`);
			currentType = currentType.inner;
			this.builder.move(memReg(Register.r0), reg(Register.r0)); // Deref for each level
		}

		const innerSize = this.compiler.resolveTypeSize(currentType);

		for (let i = 0; i < innerSize; i++) {
			this.builder.add(memReg(Register.r0), imm(i), reg(Register.r1));
			this.builder.push(memReg(Register.r0));
		}
	}

	public getTypeOfLocal(name: string): ASTTypeRef {
		if (!this.isDefined(name)) throw new Error(`Local variable '${name}' is not defined in function '${this.name}'.`);
		if (this.compiler.functions.has(name)) {
			const fns = this.compiler.functions.get(name);
			if (fns.length > 1) throw new Error(`Unable to get type of function '${name}' due to being an overloaded function`);
			return fns[0].type;
		}
		return this.locals.get(name)?.type ?? this.forwardDeclaredParameters.get(name)?.type;
	}

	public isDefined(name: string): boolean {
		return this.locals.has(name) || this.forwardDeclaredParameters.has(name) || this.compiler.functions.has(name);
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

	public createCallInfoForLocal(name: string): FunctionCallInfo {
		const local = this.locals.get(name);
		if (!local) throw new Error(`Local variable '${name}' is not defined in function '${this.name}'.`);
		if (local.type.type !== ASTType.FunctionTypeRef) throw new Error(`Local variable '${name}' is not a function type, cannot create call info.`);

		const argSize = local.type.parameters.reduce((acc, param) => acc + this.compiler.resolveTypeSize(param), 0);
		return {
			getAddress: () => {
				this.builder.move(memReg(Register.fp, local.stackOffset), reg(Register.r0));
				return reg(Register.r0);
			},
			addressExtraInstructionCount: 1,
			returnType: local.type.returnType,
			argumentSize: argSize
		};
	}

	public getCallInfo(): FunctionCallInfo {
		return {
			getAddress: () => label(this.label),
			addressExtraInstructionCount: 0,
			returnType: this.type.returnType,
			argumentSize: this.argSize
		};
	}
}

export { FunctionContext };
