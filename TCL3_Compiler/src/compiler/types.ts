import { INT_SIZE } from "../ir/irBuilder.js";
import { ASTType, ASTTypeRef, RawTypeRef, WrappedTypeRef } from "../parser/ast.js";
import { TokenType } from "../parser/tokenizer.js";

const primitiveSizeMap: Record<PrimitiveTypeName, number> = {
	void: 0,
	int: INT_SIZE,
	char: INT_SIZE,
	bool: INT_SIZE
};

const primitiveTypeNames = ["void", "int", "char", "bool"] as const;
type PrimitiveTypeName = (typeof primitiveTypeNames)[number];
const isPrimitiveTypeName = (type: string): type is PrimitiveTypeName => {
	return primitiveTypeNames.includes(type as PrimitiveTypeName);
};

// generateExactTypeText guarantees that the returned type string is valid TLC3 syntax to generate the type
// Otherwise the function is allowed to generate human readable type strings
function typeToStr(type: ASTTypeRef, generateExactTypeText = false): string {
	let result = "";
	let current = type;
	let pendingStars = "";
	while (true) {
		if (current.type == ASTType.WrappedTypeRef) {
			pendingStars += "*";
			current = current.inner;
		} else if (current.type == ASTType.FunctionTypeRef) {
			let fnType = `Fn<`;
			current.parameters.forEach((p, idx) => {
				if (idx > 0) fnType += ", ";
				// if (p.nameToken) fnType += `${p.nameToken.value}: `;
				fnType += typeToStr(p.type, generateExactTypeText);
			});
			// if (current.parameters.length > 0) fnType += ", ";
			if (!generateExactTypeText) fnType += `>: ${typeToStr(current.returnType, generateExactTypeText)}`;
			else fnType += `, ${typeToStr(current.returnType, generateExactTypeText)}>`;
			result += fnType;
			result += pendingStars;
			pendingStars = "";
			break;
		} else if (current.type == ASTType.RawTypeRef) {
			result += current.rawTypeToken.value;
			result += pendingStars;
			pendingStars = "";
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

const errorType = (): RawTypeRef => {
	return {
		type: ASTType.RawTypeRef,
		rawType: "int",
		rawTypeToken: { type: TokenType.Identifier, value: "(unknown)", start: -1, end: -1, fileIdentifier: `generated` }
	};
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

export {
	primitiveSizeMap,
	typeToStr,
	rawTypeOf,
	intType,
	charType,
	boolType,
	voidType,
	ptrOf,
	errorType,
	primitiveTypeNames,
	PrimitiveTypeName,
	isPrimitiveTypeName
};
