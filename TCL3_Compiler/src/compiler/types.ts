import { INT_SIZE } from "../ir/irBuilder.js";
import { ASTType, ASTTypeRef, RawTypeRef, WrappedTypeRef } from "../parser/ast.js";
import { TokenType } from "../parser/tokenizer.js";

const primitiveSizeMap: Record<string, number> = {
	void: 0,
	int: INT_SIZE,
	char: INT_SIZE,
	bool: INT_SIZE
};

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
			result += current.rawTypeToken.value;
			break;
		}
	}

	return result;
}

const rawTypeOf = (type: string): RawTypeRef => {
	return {
		type: ASTType.RawTypeRef,
		rawType: type,
		rawTypeToken: { type: TokenType.Identifier, value: type, start: -1, end: -1, fileIdentifier: `generated` }
	};
};

const intType = (): RawTypeRef => {
	return rawTypeOf("int");
};

const charType = (): RawTypeRef => {
	return rawTypeOf("char");
};

const boolType = (): RawTypeRef => {
	return rawTypeOf("bool");
};

const voidType = (): RawTypeRef => {
	return rawTypeOf("void");
};

const ptrOf = (type: ASTTypeRef): WrappedTypeRef => {
	return { type: ASTType.WrappedTypeRef, inner: type };
};

export { primitiveSizeMap, typeToStr, rawTypeOf, intType, charType, boolType, voidType, ptrOf };
