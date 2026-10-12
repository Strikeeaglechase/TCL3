# TCL3 Issues

This document tracks unresolved implementation defects discovered while reconciling `spec.md` with the source code. Settled language rules are documented in `spec.md` rather than retained here.

## Status conventions

- **Confirmed defect**: The implementation contradicts behavior defined by the language specification, accepts syntax it cannot compile, or produces unsafe output contrary to that specification.
- **Known limitation**: The behavior is consistently implemented but may be reconsidered as the language develops.

## Confirmed defects

### ISS-005: Several tokenized compound operators cannot be parsed

Relevant code: `src/parser/tokenizer.ts:5` and `src/parser/parser.ts:648-649`.

The tokenizer recognizes `|=`, `&=`, `^=`, `>>=`, and `<<=`, but assignment parsing only handles `+=`, `-=`, `*=`, `/=`, and `%=`.

The unused compound operators therefore fail after tokenization rather than applying the corresponding binary operation and assigning the result.

### ISS-006: Indexing overloads cannot be invoked

Relevant code: `src/parser/parser.ts:35`, `src/parser/parser.ts:527-603`, and `src/compiler/compiler.ts:705-805`.

`"["` is accepted as an operator-overload method name, but array indexing is represented as a reference-offset expression rather than an overloadable operation. Indexing a struct value does not dispatch to its `"["` method as required by the specification.

### ISS-007: `char` and `bool` aliases have no concrete size

Relevant code: `src/parser/parser.ts:36` and `src/compiler/compiler.ts:98-101`.

`char` and `bool` are aliases of `int` and must therefore occupy one cell, compare as the same type, and produce equivalent pointer types. Neither alias appears in `primitiveSizeMap`, so concrete declarations currently fail.

```c
let letter: char = 'A'; // Currently reports: Unsupported type: char
let ready: bool = true; // Currently reports: Unsupported type: bool
```

### ISS-013: Complex multi-level dereferencing does not advance its tracked type

Relevant code: `src/compiler/compiler.ts:264-286`.

The emitted address is dereferenced at each level, but `currentType` is not changed inside the loop. With three or more pointer layers, the final copy size can therefore be calculated from the wrong pointer layer. This is particularly dangerous when the final pointee is a multi-cell struct.

### ISS-018: `continue` skips the increment of a `for` loop

Relevant code: `src/compiler/compiler.ts:301-320`.

The `continue` target is the loop-top label placed before the condition. The increment is emitted after the body, so a `continue` jumps over it. A `for` loop must execute its increment clause before beginning the next condition check after `continue`.

### ISS-020: Explicit enum values do not advance implicit numbering

Relevant code: `src/parser/parser.ts:282-299`.

An implicit enum member must be one greater than the preceding member, including when that preceding member has an explicit value.

```c
enum Example {
   A: 10,
   B,     // Must be 11
   C      // Must be 12
}
```

The implementation instead maintains a separate zero-based counter for implicit members.

### ISS-027: Non-void self-recursion is rejected during type setup

Relevant code: `src/compiler/functionContext.ts:53-97`, `src/compiler/compiler.ts:1002-1033`, and `src/compiler/compiler.ts:1105-1122`.

Declaration order is part of the language, but a function is considered declared within its own body and may call itself. The compiler currently registers a function only after inspecting its return statements and inferred local types, so a recursive call encountered during that inspection cannot resolve the function being defined.

## Known limitations currently reflected in `spec.md`

- No array bounds checking.
- No check that an array initializer fits its allocation.
- No memory deallocation.
- Only one bracketed allocation dimension is accepted in a declaration type.
- Named struct initialization supports only one-cell fields; nested structs must be assigned afterward.
- Static methods cannot be overloaded.
- Escape sequences are not processed in character or string literals.
- Postfix increment and decrement are not implemented.
- Function overloading cannot be resolved by return type alone.
- Overloaded function names cannot be used as function-pointer values.
