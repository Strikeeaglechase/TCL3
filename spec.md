# Turing Complete Language 3 (TCL3) Spec

TCL3 is case-sensitive. Identifiers begin with a letter or underscore and may contain letters, digits, and underscores.

`//` begins a single-line comment. Block comments are not supported.

Semicolons are accepted as standalone no-op statements and are therefore optional after most statements. They are required between the three clauses of a `for` loop and after struct field declarations.

## Program structure

Execution begins at a function named `main`:

```c
fn main(): void {
   // Program entry point
}
```

Declarations are compiled in source/link order. A function, struct, or enum must be declared before code that needs its type or calls it. In the current implementation, `main` must also be the last function or struct-with-methods declaration because execution otherwise falls through into code emitted after it.

Variables may only be declared inside functions. All variables in a function share one function-wide scope; blocks do not introduce a new variable scope. Local declarations are discovered before the function body is compiled, so a local name is known throughout its function, although reading it before its initializer executes reads whatever value is already in its storage.

## Preprocessor and multiple files

Preprocessor directives begin with `#` and occupy one line.

### Defines

`#define` performs token substitution for later uses of an identifier in the same file:

```c
#define ARRAY_SIZE 5

fn main(): void {
   let values: int[ARRAY_SIZE] = {};
}
```

Defines do not take parameters and are not shared with included files.

### Includes

`#include` links another source file. The path is resolved relative to the file containing the directive:

```c
#include ./math.tcl3
```

Included files are processed before files that include them. Including the same resolved file more than once does not compile it more than once.

### Exports

Top-level function, struct, and enum names are private to their source file unless exported. Multiple names may be comma-separated:

```c
#export add, Point
```

The primary file's `main` function is exported automatically. Private symbols are internally renamed to prevent ordinary cross-file name collisions.

## Variable declaration

`let <name>: <type> = <expression>;`

```c
let x: int = 5;
```

The type may be omitted when it can be inferred from the initializer:

```c
let x = 5;
let point = Point.new(3, 4);
```

An initializer is always required. Reassignments use `=`:

```c
x = 10;
```

## Array declaration

`let <name>: <elementType>[<sizeExpression>] = {<expression1>, <expression2>, ..., <expressionN>};`

```c
let arr: int[5] = {1, 2, 3, 4, 5};
```

The size is evaluated at runtime and may be any integer expression:

```c
let size = 4;
let arr: int[size + 1] = {};
```

An initializer may be empty or contain fewer values than the allocated length:

```c
let arr: int[5] = {};
```

Brackets in a declaration allocate `size * sizeof(elementType)` cells. The declared value itself has type `<elementType>*`, so arrays are passed and returned as pointers:

```c
fn first(values: int*): int values[0]
```

Array indexing is zero-based, accepts an expression, and may be chained for pointer-to-pointer values:

```c
let value = matrix[row][column];
```

Only one bracketed allocation may appear in a declaration type. Arrays of pointers can instead be declared with a pointer element type, such as `int*[count]`. There is currently no bounds checking and no check that the initializer count fits the allocation.

## Memory management

Memory is measured in cells rather than bytes. `int`, pointers, enum values, and function pointers each occupy one cell. A struct occupies the sum of the sizes of its fields.

### Pointer types

A pointer type appends `*` to its pointee type. Pointers may be nested:

```c
let value: int = 5;
let pointer: int* = &value;
let pointerToPointer: int** = &pointer;
```

### Address-of

`&` produces the address of a variable, array element, or struct field:

```c
let pointer = &value;
let elementPointer = &values[index];
let fieldPointer = &point.x;
```

The operand must be a reference; an arbitrary temporary expression does not have an address.

### Dereference

`*` reads or writes through a pointer. Multiple dereferences may be combined:

```c
let value = *pointer;
let nestedValue = **pointerToPointer;
*pointer = 10;
```

### Allocation

The built-in `malloc(size)` allocates `size` cells and returns a `void*`. Allocated memory is never freed:

```c
let values: int* = malloc(count * sizeof(int));
```

## Types

### `int`

`int` is the concrete numeric type. Its final bit width is not specified. Arithmetic currently uses the host numeric representation, while bitwise operators use signed 32-bit behavior.

Decimal integer literals are supported:

```c
let count: int = 42;
```

### `void`

`void` has size zero and is used for functions that do not return a value:

```c
fn log(value: int): void {
   out value;
}
```

### Boolean values

`true` and `false` are numeric literals with values `1` and `0`. Conditions treat zero as false and any nonzero value as true.

The parser recognizes `bool` as a type name, but concrete `bool` variables are not currently supported by the compiler's type-size system. Use `int` for stored Boolean values.

### Character literals

A single-quoted literal produces the numeric character code of exactly one character:

```c
let letter: int = 'A';
```

Escape sequences are not currently processed. The parser recognizes `char` as a type name, but concrete `char` values are not currently supported by the compiler's type-size system. Use `int` for stored character codes.

### String literals

A double-quoted literal is stored as a null-terminated sequence of numeric character codes and evaluates to a pointer to its first cell:

```c
let message: int* = "Hello, World!";
```

There is no built-in `string` type. String literals should currently be given an explicit `int*` type; inferred string-literal types are not reliable. Escape sequences are not processed.

### Pointer types

`T*` is a one-cell pointer to `T`. Any number of `*` wrappers may be used.

### Function types

`Fn<Arg1, Arg2, ..., Return>` is a one-cell function pointer type. The last type argument is always the return type:

```c
let operation: Fn<int, int, int> = add;
let unary: Fn<int, int> = increment;
```

A non-overloaded function name may be used as a function-pointer value. An overloaded function cannot be converted to a function pointer because its overload would be ambiguous.

### `struct`

Structs must be defined as top-level named types; inline struct types are not supported:

```c
struct Point {
   x: int;
   y: int;
}
```

A struct is a value type. Assignment, argument passing, and return copy all of its cells.

Struct values use named field initializers:

```c
let point: Point = {x: 10, y: 20};
```

Initializers may be partial or empty:

```c
let point: Point = {x: 10};
let emptyPoint: Point = {};
```

Named initialization currently supports only fields whose value fits in one cell. Larger nested-struct fields should be assigned after declaration:

```c
let outer: Outer = {};
outer.inner = inner;
```

Access a field on a struct value with `.` and on a struct pointer with `->`:

```c
let x = point.x;
let pointPointer = &point;
let y = pointPointer->y;
```

Member access may be chained:

```c
let value = outer.inner.value;
let other = outerPointer->inner.value;
```

#### Instance methods

Functions declared inside a struct are instance methods:

```c
struct Point {
   x: int;
   y: int;

   fn scale(factor: int): void {
      this->x *= factor;
      this->y *= factor;
   }
}
```

Every instance method receives an implicit `this` parameter of type `<Struct>*`:

```c
point.scale(2);
pointPointer->scale(2);
```

Methods may be overloaded by parameter types. All overloads with the same name in one struct must have the same return type.

#### Static methods

A method prefixed by `static` has no implicit `this` parameter and is called through the struct type:

```c
struct Point {
   x: int;
   y: int;

   static fn new(x: int, y: int): Point {
      let point: Point = {x: x, y: y};
      return point;
   }
}

let point = Point.new(3, 4);
```

Static methods cannot currently be overloaded.

#### Operator overloading

An instance method whose name is a double-quoted operator overloads that binary operator:

```c
struct Point {
   x: int;
   y: int;

   fn "+"(other: Point): Point {
      let result: Point = {
         x: this->x + other.x,
         y: this->y + other.y
      };
      return result;
   }
}
```

The implemented overloadable binary operators are `+`, `-`, `*`, `/`, `==`, `!=`, `<`, `>`, `<=`, `>=`, `&&`, `||`, `&`, `|`, `^`, `<<`, and `>>`.

Overloads may themselves be overloaded by the explicit operand type. For the commutative operators `+`, `*`, `==`, `!=`, `&`, `|`, and `^`, a built-in integer on the left and a struct on the right are reordered so that the struct can be the receiver.

### `enum`

An enum is a one-cell integer-like value. Implicit values begin at zero:

```c
enum HTTPMethod {
   GET,
   POST,
   TRACE
}
```

Explicit values use `:`:

```c
enum HTTPStatus {
   ok: 200,
   notFound: 404
}
```

Variants are referenced through the enum name:

```c
let method: HTTPMethod = HTTPMethod.GET;
```

When explicit and implicit variants are mixed, the current implementation's implicit counter is independent of explicit values. For example, in `{ A: 10, B }`, `B` is currently `0`.

## Flow control

Conditions accept numeric values: zero is false and any nonzero value is true.

### `if`, `elif`, and `else`

```c
if (value == 1) {
   out 1;
} elif (value == 2) {
   out 2;
} else {
   out 0;
}
```

The keyword is `elif`, not `elseif`.

### `while`

```c
while (condition) {
   work();
}
```

### `for`

```c
for (let index: int = 0; index < count; index += 1) {
   out index;
}
```

The initializer runs once, the condition is tested before each iteration, and the increment runs after each normally completed body. There is no trailing semicolon after the increment clause.

In the current implementation, `continue` in a `for` loop jumps directly to the condition and skips the increment clause.

### Single-statement bodies

Braces may be omitted when an `if`, `elif`, `else`, `while`, or `for` body contains one statement:

```c
if (ready) out 1;
while (condition) work();
for (let index = 0; index < count; index += 1) out index;
```

### `break` and `continue`

`break` exits the innermost loop. `continue` jumps to the next condition check of the innermost loop. Both are errors outside a loop.

## Functions and calls

Parameters always have explicit types:

```c
fn add(left: int, right: int): int {
   return left + right;
}

let value = add(2, 4);
```

A braced non-`void` function uses `return <expression>`. A `void` function may normally reach the end of its body or use `return;` to exit early. The semicolon is required for the expressionless form because it supplies the empty statement parsed by `return`.

The return type may be omitted when every return expression allows it to be inferred:

```c
fn add(left: int, right: int) {
   return left + right;
}
```

An unbraced function consists of one expression and returns it implicitly:

```c
fn add(left: int, right: int): int left + right
```

Only expression-bodied functions receive an implicit return. A braced function does not implicitly return its final expression.

Functions may return structs by value, and a returned value may immediately be used in another call, binary expression, index, or member access:

```c
out makePoint(3, 4).x;
out add(1, add(2, 3));
```

### Function overloading

Top-level functions may share a name when their parameter type lists differ:

```c
fn add(left: int, right: int): int left + right
fn add(left: Point, right: Point): Point {
   // ...
}
```

The argument types select the overload. Return type alone cannot distinguish overloads.

### Function pointers

Function pointers may be stored in variables, struct fields, pointers, and arrays, and are called with the ordinary call syntax:

```c
fn increment(value: int): int value + 1

let operation: Fn<int, int> = increment;
out operation(4);
```

## Built-ins and output

### `out`

`out <expression>` evaluates an expression, removes one cell from its result, and sends that numeric value to the runtime output stream:

```c
out 42;
out 'A';
```

### `malloc`

`malloc(size)` allocates the requested number of cells and returns a `void*`. It takes exactly one argument.

### `sizeof`

`sizeof(reference)` returns a compile-time size measured in cells. It takes exactly one reference and does not evaluate that reference as an ordinary expression:

```c
out sizeof(int);
out sizeof(Point);
out sizeof(point);
out sizeof(point.x);
```

For an array variable, `sizeof(array)` returns the size of its pointer, not the number of allocated elements.

## Operators

| Operator | Symbol |
| --- | --- |
| Addition | `+` |
| Subtraction | `-` |
| Multiplication | `*` |
| Division | `/` |
| Numeric negation | `-` |
| Bitwise OR | `\|` |
| Bitwise AND | `&` |
| Bitwise XOR | `^` |
| Bitwise NOT | `~` |
| Left shift | `<<` |
| Signed right shift | `>>` |
| Logical OR | `\|\|` |
| Logical AND | `&&` |
| Logical NOT | `!` |
| Equality | `==` |
| Inequality | `!=` |
| Less than | `<` |
| Less than or equal | `<=` |
| Greater than | `>` |
| Greater than or equal | `>=` |
| Assignment | `=` |
| Addition assignment | `+=` |
| Subtraction assignment | `-=` |
| Multiplication assignment | `*=` |
| Division assignment | `/=` |
| Address-of | `&` |
| Dereference | `*` |

Division currently rounds the host-language quotient down with `Math.floor`. Logical `&&` and `||` normalize their result to `0` or `1`, but both operands are currently evaluated; they do not short-circuit.

Modulo (`%` and `%=`), postfix increment/decrement (`++` and `--`), explicit casts, and compound bitwise/shift assignments are not currently implemented.

Assignments are statements rather than general value-producing expressions.

## Operator precedence

The intended precedence levels encoded by the parser are listed from tightest to loosest. Parentheses override the normal grouping.

The current parser has known precedence and associativity defects when multiple binary or unary operators are mixed. Until those are corrected, parentheses should be used to make every mixed expression explicit.

| Precedence | Operator | Description | Intended associativity |
| --- | --- | --- | --- |
| 1 | `()` | Function call and grouping | Left to right |
| 1 | `[]` | Array indexing | Left to right |
| 1 | `.` | Struct member access | Left to right |
| 1 | `->` | Struct-pointer member access | Left to right |
| 2 | `! ~ -` | Logical NOT, bitwise NOT, negation | Right to left |
| 2 | `* &` | Dereference, address-of | Right to left |
| 3 | `* /` | Multiplication and division | Left to right |
| 4 | `+ -` | Addition and subtraction | Left to right |
| 5 | `<< >>` | Bitwise shifting | Left to right |
| 6 | `< <= > >=` | Relational comparison | Left to right |
| 7 | `== !=` | Equality comparison | Left to right |
| 8 | `&` | Bitwise AND | Left to right |
| 9 | `^` | Bitwise XOR | Left to right |
| 10 | `\|` | Bitwise OR | Left to right |
| 11 | `&&` | Logical AND | Left to right |
| 12 | `\|\|` | Logical OR | Left to right |
