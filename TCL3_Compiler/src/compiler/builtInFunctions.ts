import { v4 as uuidv4 } from "uuid";

import { Register } from "../ir/ir.js";
import { imm, reg } from "../ir/irBuilder.js";
import { ASTType, ASTTypeRef, FunctionCall, FunctionTypeRef } from "../parser/ast.js";
import { Token, TokenType } from "../parser/tokenizer.js";
import { Compiler } from "./compiler.js";
import { primitiveSizeMap, ptrOf, rawTypeOf } from "./types.js";
import { IType } from "./userTypes.js";

class BuiltInFunction implements IType {
	public readonly refId = uuidv4();
	public readonly nameToken: Token;

	constructor(
		public readonly name: string,
		private readonly parameters: { name: string; type: ASTTypeRef }[],
		public readonly returnType: ASTTypeRef,
		public readonly handleCall: (this: Compiler, call: FunctionCall) => void
	) {
		this.nameToken = {
			type: TokenType.Identifier,
			value: name,
			start: -1,
			end: -1,
			fileIdentifier: "builtInFunction"
		};
	}

	public get typeRef(): ASTTypeRef {
		const fnRef: FunctionTypeRef = {
			type: ASTType.FunctionTypeRef,
			fnKeywordToken: null,
			parameters: this.parameters.map(p => p.type),
			returnType: this.returnType
		};

		return fnRef;
	}
}

const malloc = new BuiltInFunction(
	"malloc", //
	[{ name: "size", type: rawTypeOf("int") }],
	ptrOf(rawTypeOf("void")),
	function (this: Compiler, call: FunctionCall) {
		if (call.arguments.length != 1) throw new Error(`malloc expects 1 argument, got ${call.arguments.length}`);

		this.compileAst(call.arguments[0]);
		this.builder.pop(reg(Register.r0));

		this.builder.malloc(reg(Register.r0), reg(Register.funcRet));
	}
);

const sizeof = new BuiltInFunction(
	"sizeof", //
	[{ name: "type", type: rawTypeOf("void") }],
	rawTypeOf("int"),
	function (this: Compiler, call: FunctionCall) {
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
);

const builtInFunctions: BuiltInFunction[] = [malloc, sizeof];

export { BuiltInFunction, builtInFunctions };
