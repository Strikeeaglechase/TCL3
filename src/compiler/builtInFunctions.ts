import { Register } from "../ir/ir.js";
import { imm, reg } from "../ir/irBuilder.js";
import { ASTType, ASTTypeRef, FunctionCall, RawTypeRef, WrappedTypeRef } from "../parser/ast.js";
import { Compiler, primitiveSizeMap } from "./compiler.js";

interface BuiltInFunction {
	name: string;
	returnType: ASTTypeRef;

	handleCall: (this: Compiler, call: FunctionCall) => void;
}

const rawType = (type: string): ASTTypeRef => {
	const raw: RawTypeRef = {
		type: ASTType.RawTypeRef,
		rawType: type
	};
	return raw;
};

const ptrType = (inner: string): ASTTypeRef => {
	const wrapped: WrappedTypeRef = {
		type: ASTType.WrappedTypeRef,
		inner: rawType(inner)
	};

	return wrapped;
};

const builtInFunctions: BuiltInFunction[] = [
	{
		name: "malloc",
		returnType: ptrType("void"),
		handleCall: function (this: Compiler, call: FunctionCall) {
			if (call.arguments.length != 1) throw new Error(`malloc expects 1 argument, got ${call.arguments.length}`);

			this.compileAst(call.arguments[0]);
			this.builder.pop(reg(Register.r0));

			this.builder.malloc(reg(Register.r0), reg(Register.funcRet));
		}
	},
	{
		name: "sizeof",
		returnType: rawType("int"),
		handleCall: function (this: Compiler, call: FunctionCall) {
			if (call.arguments.length != 1) throw new Error(`sizeof expects 1 argument, got ${call.arguments.length}`);
			if (call.arguments[0].type != ASTType.Reference) throw new Error(`sizeof expects a reference as its argument, got ${call.arguments[0].type}`);
			// Try struct first

			if (this.structs.has(call.arguments[0].identifier)) {
				const struct = this.structs.get(call.arguments[0].identifier);
				this.builder.move(imm(struct.size), reg(Register.funcRet));
				return;
			}

			if (primitiveSizeMap[call.arguments[0].identifier] !== undefined) {
				const size = primitiveSizeMap[call.arguments[0].identifier];
				this.builder.move(imm(size), reg(Register.funcRet));
				return;
			}

			// Not a struct, evaluate type
			const { type } = this.getFinalTypeOfReference(call.arguments[0]);
			const size = this.resolveTypeSize(type);
			this.builder.move(imm(size), reg(Register.funcRet));
		}
	}
];

export { BuiltInFunction, builtInFunctions };
