# TCL3 Issues and Open Language Questions

This document tracks implementation defects, unresolved language semantics, and intentional limitations discovered while reconciling `spec.md` with the source code.

## Status conventions

- **Confirmed defect**: The implementation contradicts its apparent intent, accepts syntax it cannot compile, produces unsafe output, or violates behavior encoded elsewhere.
- **Open semantic question**: The implementation has observable behavior, but it is unclear whether that behavior should become part of the language.
- **Known limitation**: The behavior is consistently implemented but may be reconsidered as the language develops.

## Confirmed defects

### ISS-001: Binary precedence and associativity are not applied correctly

Relevant code: `src/parser/parser.ts:502-522`, `src/parser/parser.ts:648`, and `src/parser/parser.ts:768`.

Every primary expression can begin a new binary-expression parse with the default precedence. As a result, the right operand consumes the remainder of the expression before the outer precedence comparison can organize it.

Confirmed examples:

```c
out 2 * 3 + 4; // Currently 14; intended precedence produces 10
out 1 < 2 == 1; // Currently groups as 1 < (2 == 1)
```

Operators also group right-to-left rather than using the associativity in the precedence table.

### ISS-002: Unary operators consume too much of the following expression

Relevant code: `src/parser/parser.ts:709-740`.

Unary `-`, `!`, and `~` parse their operand using `parseStatement()`, which can consume a complete binary expression.

Confirmed example:

```c
out -1 + 2; // Currently -(1 + 2), producing -3 instead of 1
```

### ISS-003: Number tokenization absorbs subtraction signs and decimal points

Relevant code: `src/parser/tokenizer.ts:21`, `src/parser/tokenizer.ts:126-129`, and `src/compiler/compiler.ts:681-685`.

After a numeric literal begins, every digit, period, and hyphen is consumed into the same token. The compiler then uses `parseInt`.

Confirmed examples:

```c
out 8-3;  // Tokenized as one literal and currently produces 8
out 1.9;  // Accepted by the tokenizer but currently produces 1
```

Whitespace changes the meaning of subtraction, and malformed numeric strings may be partially accepted instead of rejected.

### ISS-004: Modulo is accepted by the front end but unsupported by the compiler

Relevant code: `src/parser/tokenizer.ts:4-5`, `src/parser/tokenizer.ts:7-26`, `src/parser/parser.ts:646-647`, and `src/compiler/compiler.ts:758-790`.

`%` has a precedence entry, and `%=` is converted into a `%` binary expression, but there is no modulo IR instruction or compiler handler.

```c
out 5 % 2; // Compilation error: Unsupported binary operator: %
```

### ISS-005: Several tokenized compound operators cannot be parsed

Relevant code: `src/parser/tokenizer.ts:5` and `src/parser/parser.ts:646-647`.

The tokenizer recognizes `|=`, `&=`, `^=`, `>>=`, and `<<=`, but assignment parsing only handles `+=`, `-=`, `*=`, `/=`, and `%=`.

The unused compound operators therefore fail after tokenization rather than being implemented or rejected lexically.

### ISS-006: The parser accepts an indexing overload that can never be invoked

Relevant code: `src/parser/parser.ts:34`, `src/parser/parser.ts:525-601`, and `src/compiler/compiler.ts:695-750`.

`"["` is accepted as an operator-overload method name, but array indexing is represented as reference-offset expressions rather than a binary `[` operation. No indexing path dispatches the declared overload.

### ISS-007: `char` and `bool` are recognized but have no size

Relevant code: `src/parser/parser.ts:35` and `src/compiler/compiler.ts:96-99`.

Both names are protected as built-in types, and both are treated as integer-like by some type checks. Neither appears in `primitiveSizeMap`, so concrete declarations fail.

```c
let letter: char = 'A'; // Unsupported type: char
let ready: bool = true; // Unsupported type: bool
```

Pointer wrappers such as `char*` occupy one cell, but dereferencing or indexing them eventually requires the missing pointee size.

### ISS-008: String literals infer the wrong type

Relevant code: `src/compiler/compiler.ts:833-859`.

Every literal is inferred as `int`, including a string literal whose runtime value is a pointer.

```c
let text = "A";
out text[0]; // Error: attempts to index an inferred int
```

An explicit `int*` annotation works around the issue.

### ISS-009: Calls with a single candidate skip argument validation

Relevant code: `src/compiler/compiler.ts:1050-1071` and `src/compiler/compiler.ts:1166-1181`.

When only one function or method has a given name, overload resolution returns it without comparing argument count or argument types.

Confirmed example:

```c
fn value(input: int): int input

fn main(): void {
   out value(); // Compiles and reads unrelated stack storage as input
}
```

Incorrect argument sizes can corrupt the calling convention, especially for struct arguments.

### ISS-010: Function-pointer calls do not validate arguments

Relevant code: `src/compiler/compiler.ts:1184-1227` and `src/compiler/functionContext.ts:333-347`.

The function-pointer type supplies an expected argument size, but each provided argument is compiled without checking its type or count against the function signature.

### ISS-011: Typed declarations do not validate their initializer

Relevant code: `src/compiler/compiler.ts:870-917`.

When an explicit variable type is present, the compiler allocates that type but does not compare it with the initializer's inferred type. Later assignments only print a warning and still emit the copy.

Relevant code for reassignment warnings: `src/compiler/compiler.ts:363-381`.

This can leave extra cells on the stack or copy the wrong number of cells when a scalar and struct are mixed.

### ISS-012: Simple pointer reads of multi-cell values repeat the first cell

Relevant code: `src/compiler/functionContext.ts:280-306`.

The loop computes an offset into `r1` but always pushes `MEM_REG(r0)` instead of using the offset address.

Confirmed example:

```c
struct Pair {
   a: int;
   b: int;
}

let pair: Pair = {a: 1, b: 2};
let pointer = &pair;
let copy = *pointer;

out copy.a; // 1
out copy.b; // Currently 1 instead of 2
```

### ISS-013: Complex multi-level dereferencing does not advance its tracked type

Relevant code: `src/compiler/compiler.ts:255-277`.

The emitted address is dereferenced at each level, but `currentType` is not changed inside the loop. The final copy size can therefore be calculated from the wrong pointer layer. This is particularly dangerous when the final pointee is a multi-cell struct.

### ISS-014: Struct-return calls leak their hidden return pointer

Relevant code: `src/compiler/compiler.ts:1196-1226` and `src/compiler/compiler.ts:1242-1276`.

For a multi-cell return, the caller pushes a hidden destination pointer before the ordinary arguments. Stack cleanup subtracts only the ordinary argument size for direct calls, or the ordinary arguments plus function pointer for indirect calls. The hidden pointer remains on the stack after every call.

Repeated struct-return calls therefore grow the stack even after their result has been consumed.

### ISS-015: `main` falls through into code emitted after it

Relevant code: `src/compiler/compiler.ts:157-166` and `src/compiler/compiler.ts:1017-1024`.

The compiler emits one final halt after all declarations. Unlike ordinary functions, `main` has no epilogue or jump to that halt. If a function or a struct containing methods is declared after `main`, execution continues directly into that generated function body without a valid call frame.

### ISS-016: `return` in `main` targets a missing label

Relevant code: `src/compiler/compiler.ts:931-935`, `src/compiler/compiler.ts:1021-1027`.

Every return jumps to the current function's `outLabel`, but `main` exits `handleFunctionDeclaration` before that label is emitted.

```c
fn main(): void {
   return; // Runtime error: Label not found
}
```

### ISS-017: Non-void functions do not require every path to return

Relevant code: `src/compiler/functionContext.ts:53-90`.

Return checking collects existing return statements and verifies their types, but it performs no control-flow analysis. A function is accepted if it has a compatible return anywhere, even when another path falls through.

Confirmed example:

```c
fn maybe(value: int): int {
   if (value) return 5;
}
```

Calling `maybe(0)` returns stale stack data.

### ISS-018: `continue` skips the increment of a `for` loop

Relevant code: `src/compiler/compiler.ts:291-310`.

The `continue` target is the loop-top label placed before the condition. The increment is emitted after the body, so a `continue` jumps over it.

This contradicts the conventional `for` rule and the previous language specification.

### ISS-019: Logical operators always evaluate both operands

Relevant code: `src/compiler/compiler.ts:737-779`.

Both operands are compiled before `LOGIC_AND` or `LOGIC_OR` executes.

```c
true || functionWithSideEffects();  // Side effects still occur
false && functionWithSideEffects(); // Side effects still occur
```

Whether this is a defect depends on the resolution of SEM-002.

### ISS-020: Explicit enum values do not advance implicit numbering

Relevant code: `src/parser/parser.ts:275-298`.

`currentValue` is incremented only when a variant is implicit.

```c
enum Example {
   A: 10,
   B      // Currently 0
}
```

Whether this is a defect depends on the resolution of SEM-005.

### ISS-021: Methods share the global function registry

Relevant code: `src/compiler/userTypes.ts:21-39` and `src/compiler/compiler.ts:975-1003`.

Every struct method is passed through the same registration path as a top-level function and is stored under its unqualified method name. Consequently:

- Two unrelated structs can conflict if they define the same method signature.
- A method name can conflict with a top-level function.
- A method may become visible to simple-name function lookup without a receiver.

Method identity should include its owning struct, or methods should use a separate registry.

### ISS-022: Runtime stack and heap regions can overlap

Relevant code: `src/compiler/compiler.ts:157-159` and `src/emulator.ts:29-48`.

The heap pointer always begins at cell 255. The stack begins immediately after stored strings, and both grow upward. There is no collision check between strings, the stack, and heap allocations.

Long string tables can begin the stack beyond the heap base, while sufficiently large functions or allocations can make the regions overwrite one another.

### ISS-023: Memory bounds and allocation sizes are not validated

Relevant code: `src/emulator.ts:3`, `src/emulator.ts:232-275`, and `src/ir/irBuilder.ts:64-67`.

The emulator creates 64K cells but JavaScript arrays can silently grow on writes. There is no explicit rejection of:

- Negative allocation sizes.
- Heap exhaustion.
- Negative addresses.
- Stack underflow or overflow.
- Out-of-range array access.
- Array initializers larger than their allocation.

### ISS-024: Empty character literals are accepted

Relevant code: `src/parser/tokenizer.ts:112-123`.

Only character literals longer than one character are rejected. An empty literal reaches `charCodeAt(0)` and produces `NaN`, which later propagates through numeric parsing.

### ISS-025: Writable identical string literals alias one another

Relevant code: `src/ir/irBuilder.ts:86-89` and `src/emulator.ts:29-38`.

Identical strings are deduplicated into one runtime address, and string memory is writable. Mutating one occurrence therefore mutates every identical literal in the program.

The language should either make literal storage immutable, stop deduplicating writable strings, or explicitly define this aliasing.

### ISS-026: Private symbols can collide for files with the same basename

Relevant code: `src/parser/linker.ts:29-35` and `src/parser/parser.ts:440-450`.

Private-name mangling uses only the source file's basename. Two included files such as `first/util.tcl3` and `second/util.tcl3` generate the same private prefix and can collide.

### ISS-027: Non-void recursion is frequently rejected during type setup

Relevant code: `src/compiler/functionContext.ts:53-96`, `src/compiler/compiler.ts:975-1003`, and `src/compiler/compiler.ts:1074-1098`.

A function is registered only after its return statements and inferred local types are inspected. Recursive calls encountered during that inspection cannot resolve the function being defined. Void recursion without return-type inference may work, but ordinary value-returning recursion is unreliable.

## Open semantic questions

### SEM-001: What are `char` and `bool`?

Decide whether:

- `char` and `bool` are distinct one-cell types.
- They are aliases of `int` used only for intent and type checking.
- They remain reserved for future implementation and are removed from the current language spec.

Also decide whether `char` represents an 8-bit value, a Unicode code point, or the runtime's native character unit.

Current documentation treats character and Boolean literals as integers and marks concrete `char`/`bool` values unsupported.

### SEM-002: Should `&&` and `||` short-circuit?

Current behavior eagerly evaluates both operands and then normalizes the result to `0` or `1`.

Choices include:

- C-like left-to-right short-circuit evaluation.
- Eager evaluation as a defined language rule.

This decision affects side effects, safety checks, and the compiler's control-flow generation.

### SEM-003: How should signed division round?

Current behavior uses `Math.floor`:

```c
(0 - 3) / 2 == -2
```

Possible rules include:

- Floor toward negative infinity, matching the current runtime.
- Truncate toward zero, matching C and JavaScript integer-conversion expectations.
- Euclidean division paired with a future modulo definition.

The division-by-zero rule is also unspecified. The current runtime can produce non-finite host values.

### SEM-004: What should `continue` do in a `for` loop?

Current behavior jumps directly to the condition and skips the increment clause. The conventional rule executes the increment before rechecking the condition.

The old specification described the conventional rule, so the current implementation is provisionally cataloged as a defect.

### SEM-005: How should implicit enum values follow explicit values?

Current behavior maintains a separate zero-based implicit counter:

```c
enum Example {
   A: 10,
   B,     // 0
   C      // 1
}
```

The common alternative assigns `B == 11` and `C == 12`. A third option is to require every member to be explicit once an explicit value is used.

### SEM-006: Is declaration order part of the language?

The current single-pass compiler generally requires functions and types to be available before dependent code is compiled. Forward calls, mutual recursion, and some self-recursion fail.

Decide whether to:

- Make declaration-before-use a language rule.
- Add a declaration/type-registration pass before body compilation.
- Introduce explicit forward declarations.

### SEM-007: How should `main` terminate?

Current code generation relies on `main` falling through to the final halt, which requires `main` to be the last code-producing declaration and makes `return` invalid.

Decide whether:

- `main` must be last and cannot return.
- `main` receives a real epilogue that jumps to program termination.
- `main` may return an integer exit status.

### SEM-008: Are type mismatches errors, warnings, or implicit conversions?

The compiler currently mixes all three approaches:

- Return mismatches are errors.
- Some assignment mismatches are warnings.
- Typed declaration initializers are not checked.
- `malloc` returns `void*`, but no cast syntax exists for converting it to another pointer type.

A consistent conversion and diagnostic policy is needed, including rules for enums, `void*`, numeric types, function pointers, and struct values.

### SEM-009: What is the integer model?

The original specification left integer width unresolved. Current arithmetic uses JavaScript numbers, while bitwise operations coerce values to signed 32-bit integers.

Decide:

- Integer width and signedness.
- Overflow behavior.
- Shift behavior and valid shift counts.
- Division and future modulo behavior.
- Whether numeric literals outside the supported range are errors or wrap.

### SEM-010: What is the canonical string and character representation?

Current string literals are null-terminated sequences of numeric host-language character units, represented operationally as `int*`. There is no usable concrete `char` type and no `string` type.

Decide whether strings should be:

- `char*` with a defined character width.
- `int*` as currently used by tests.
- A dedicated sized or null-terminated `string` type.

Also decide escape syntax, literal mutability, encoding, and whether identical literals may share storage.

### SEM-011: Should logical and comparison operators have a distinct result type?

The runtime produces `0` or `1`, but type inference for an ordinary binary expression generally returns the left operand's type. Comparisons involving enums may therefore infer an enum type rather than a Boolean or integer result.

This depends on whether `bool` becomes a real type.

### SEM-012: What initialization guarantees exist?

Empty and partial initializers perform no writes for omitted fields or elements. Initial emulator memory begins at zero, but reused stack frames may contain earlier values.

Decide whether omitted storage is:

- Guaranteed zero-initialized.
- Explicitly uninitialized.
- Rejected unless every field or element is initialized.

### SEM-013: Are semicolons optional syntax or standalone empty statements?

The parser currently treats `;` as an AST statement and does not make it part of most preceding statements. This makes semicolons optional almost everywhere while still requiring them as `for` separators and after struct fields.

Decide whether this permissive behavior is intentional or whether statement grammar should consistently require or omit terminators.

### SEM-014: Should blocks introduce lexical scopes?

All local variables are currently forward-discovered and stored in one function-wide namespace. A name declared inside a loop or conditional is visible throughout the function, and duplicate names in separate blocks conflict.

Decide whether TCL3 retains function scope or adopts nested lexical scopes and shadowing rules.

### SEM-015: Are string and aggregate expressions valid operands of `out`?

`out` always removes and emits one cell. Passing a multi-cell struct leaves the rest of the value on the stack. A string expression emits its address rather than its contents.

The language should either restrict `out` to one-cell numeric values or define aggregate/string output behavior.

## Known limitations currently reflected in `spec.md`

- No array bounds checking.
- No check that an array initializer fits its allocation.
- No memory deallocation.
- Only one bracketed allocation dimension is accepted in a declaration type.
- Named struct initialization supports only one-cell fields; nested structs must be assigned afterward.
- Static methods cannot be overloaded.
- Escape sequences are not processed in character or string literals.
- Function and type availability depends on declaration/link order.
- Local variables have function scope rather than block scope.
- Postfix increment/decrement and explicit casts are not implemented.
- Function overloading cannot be resolved by return type alone.
- Overloaded function names cannot be used as function-pointer values.
