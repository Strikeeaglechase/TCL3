# Turing Complete Language 3 (TCL3) Spec

TCL3 is case-sensitive. Identifiers begin with a letter or underscore and may contain letters, digits, and underscores.

`//` begins a single-line comment. Block comments are not supported.

Semicolons are accepted as standalone no-op statements and are therefore optional after most statements, although using them is recommended. They are required between the three clauses of a `for` loop and after struct field declarations. A future language revision may require them more broadly.

## Program structure

Execution begins at a function named `main`:

```Rust
fn main(): void {
   // Program entry point
}
```

Declaration order is part of the language. Declarations are compiled in source/link order, and a function, struct, or enum must be declared before other code uses its type or calls it. A function is considered declared within its own body and may call itself, but it cannot use later declarations.

`main` may appear before or after other declarations. Reaching the end of `main` or executing `return;` terminates the program.

Variables may only be declared inside functions. All variables in a function share one function-wide scope; blocks do not introduce a new variable scope. Local declarations are discovered before the function body is compiled, so a local name is known throughout its function.

Reading a variable before its initializer executes is undefined behavior. Its storage may contain any value.

## Preprocessor and multiple files

Preprocessor directives begin with `#` and occupy one line.

### Defines

`#define` performs token substitution for later uses of an identifier in the same file:

```Rust
#define ARRAY_SIZE 5

fn main(): void {
   let values: int[ARRAY_SIZE] = {};
}
```

Defines do not take parameters and are not shared with included files.

### Includes

`#include` links another source file. The path is resolved relative to the file containing the directive:

```Rust
#include ./math.tcl3
```

Included files are processed before files that include them. Including the same resolved file more than once does not compile it more than once.

### Exports

Top-level function, struct, and enum names are private to their source file unless exported. Multiple names may be comma-separated:

```Rust
#export add, Point
```

The primary file's `main` function is exported automatically. Private symbols are internally renamed to prevent ordinary cross-file name collisions.

## Variable declaration

`let <name>: <type> = <expression>;`

```Rust
let x: int = 5;
```

The type may be omitted when it can be inferred from the initializer:

```Rust
let x = 5;
let point = Point.new(3, 4);
```

An initializer is always required. Reassignments use `=`:

```Rust
x = 10;
```

## Array declaration

`let <name>: <elementType>[<sizeExpression>] = {<expression1>, <expression2>, ..., <expressionN>};`

```Rust
let arr: int[5] = {1, 2, 3, 4, 5};
```

The size is evaluated at runtime and may be any integer expression:

```Rust
let size = 4;
let arr: int[size + 1] = {};
```

An initializer may be empty or contain fewer values than the allocated length:

```Rust
let arr: int[5] = {};
```

Elements omitted from an array initializer are uninitialized. Reading them before assigning a value is undefined behavior.

Brackets in a declaration allocate `size * sizeof(elementType)` cells. The declared value itself has type `<elementType>*`, so arrays are passed and returned as pointers:

```Rust
fn first(values: int*): int values[0]
```

Array indexing is zero-based, accepts an expression, and may be chained for pointer-to-pointer values:

```Rust
let value = matrix[row][column];
```

Only one bracketed allocation may appear in a declaration type. Arrays of pointers can instead be declared with a pointer element type, such as `int*[count]`. There is currently no bounds checking and no check that the initializer count fits the allocation.

## Memory management

Memory is measured in cells rather than bytes. `int`, pointers, enum values, and function pointers each occupy one cell. A struct occupies the sum of the sizes of its fields.

### Pointer types

A pointer type appends `*` to its pointee type. Pointers may be nested:

```Rust
let value: int = 5;
let pointer: int* = &value;
let pointerToPointer: int** = &pointer;
```

### Address-of

`&` produces the address of a variable, array element, or struct field:

```Rust
let pointer = &value;
let elementPointer = &values[index];
let fieldPointer = &point.x;
```

The operand must be a reference; an arbitrary temporary expression does not have an address.

### Dereference

`*` reads or writes through a pointer. Multiple dereferences may be combined:

```Rust
let value = *pointer;
let nestedValue = **pointerToPointer;
*pointer = 10;
```

### Allocation

The built-in `malloc(size)` allocates `size` uninitialized cells and returns a `void*`. Reading an allocated cell before writing it is undefined behavior. Allocated memory is never freed:

```Rust
let values: int* = ▸int*◂malloc(count * sizeof(int));
```

## Types

### `int`

`int` is the numeric type. `int`, `char`, and `bool` all occupy one cell and use the same runtime representation, but they are distinct compile-time types. Converting between them requires an explicit cast. An implicit conversion is diagnosed as a warning or error depending on context.

The numeric model currently follows JavaScript and may change in a future language revision. Ordinary arithmetic uses JavaScript numbers, while bitwise operations use JavaScript's signed 32-bit coercion and shift behavior. Overflow, non-finite values, and invalid arithmetic follow the corresponding JavaScript operation.

Decimal integer literals are supported:

```Rust
let count: int = 42;
```

Numeric tokens currently permit period characters but are still converted as integers. Consequently, a decimal-looking token such as `1.9` currently evaluates to `1`; this is an implementation defect rather than decimal-number support.

### `void`

`void` has size zero and is used for functions that do not return a value:

```Rust
fn log(value: int): void {
   out value;
}
```

### Boolean values

`true` and `false` are `bool` literals represented by the values `1` and `0`. Conditions treat zero as false and any nonzero value as true.

Logical and comparison operations produce `bool` values represented by `0` or `1`. Using one as an `int` or `char` requires an explicit cast.

### Character literals

A single-quoted literal produces the numeric character code of exactly one character:

```rust
let letter: char = 'A';
```

Escape sequences are not currently processed. `char` has the same one-cell runtime representation as `int`, but converting between the two types requires an explicit cast.

### String literals

A double-quoted literal is stored as a null-terminated sequence of numeric character codes and evaluates to a pointer to its first cell:

```rust
let message = "Hello, World!";
```

There is no built-in `string` type. A string literal infers `char*`. `char*` and `int*` have the same one-cell runtime representation but are distinct compile-time types, so converting between them requires an explicit cast. Escape sequences are not processed.

### Pointer types

`T*` is a one-cell pointer to `T`. Any number of `*` wrappers may be used. Pointer types retain their pointee's compile-time identity; for example, converting between `char*` and `int*` requires an explicit cast.

### Function types

`Fn<Arg1, Arg2, ..., Return>` is a one-cell function pointer type. The last type argument is always the return type:

```rust
let operation: Fn<int, int, int> = add;
let unary: Fn<int, int> = increment;
```

A non-overloaded function name may be used as a function-pointer value. An overloaded function cannot be converted to a function pointer because its overload would be ambiguous.

### Explicit casts

`▸<type>◂<expression>` gives an expression an explicit type:

```rust
let values: int* = ▸int*◂malloc(count);
```

A cast changes the compile-time type without emitting a runtime conversion or performing safety checks. Unsafe casts, including casts between differently sized types, are allowed; ensuring that a cast is valid for the underlying value and storage is the programmer's responsibility.

### `struct`

Structs must be defined as top-level named types; inline struct types are not supported:

```rust
struct Point {
   x: int;
   y: int;
}
```

A struct is a value type. Assignment, argument passing, and return copy all of its cells.

Struct values use named field initializers:

```Rust
let point: Point = {x: 10, y: 20};
```

Initializers may be partial or empty:

```Rust
let point: Point = {x: 10};
let emptyPoint: Point = {};
```

Fields omitted from a struct initializer are uninitialized. Reading them before assigning a value is undefined behavior.

Named initialization currently supports only fields whose value fits in one cell. Larger nested-struct fields should be assigned after declaration:

```Rust
let outer: Outer = {};
outer.inner = inner;
```

Access a field on a struct value with `.` and on a struct pointer with `->`:

```Rust
let x = point.x;
let pointPointer = &point;
let y = pointPointer->y;
```

Member access may be chained:

```Rust
let value = outer.inner.value;
let other = outerPointer->inner.value;
```

#### Instance methods

Functions declared inside a struct are instance methods:

```Rust
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

```Rust
point.scale(2);
pointPointer->scale(2);
```

Methods may be overloaded by parameter types. All overloads with the same name in one struct must have the same return type.

#### Static methods

A method prefixed by `static` has no implicit `this` parameter and is called through the struct type:

```Rust
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

```Rust
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

The overloadable binary operators are `+`, `-`, `*`, `/`, `==`, `!=`, `<`, `>`, `<=`, `>=`, `&&`, `||`, `&`, `|`, `^`, `<<`, and `>>`.

Overloads may themselves be overloaded by the explicit operand type. For the commutative operators `+`, `*`, `==`, `!=`, `&`, `|`, and `^`, a built-in integer on the left and a struct on the right are reordered so that the struct can be the receiver.

An instance method named `"[]"` overloads indexing. It receives the expression between the brackets:

```Rust
struct Values {
   first: int;
   second: int;

   fn "[]"(index: int): int {
      if (index == 0) return this->first;
      return this->second;
   }
}

let values: Values = {first: 10, second: 20};
out values[1]; // 20
```

### `enum`

An enum is a one-cell integer-like value. Implicit values begin at zero:

```Rust
enum HTTPMethod {
   GET,
   POST,
   TRACE
}
```

Explicit values use `:`:

```Rust
enum HTTPStatus {
   ok: 200,
   notFound: 404
}
```

Variants are referenced through the enum name:

```Rust
let method: HTTPMethod = HTTPMethod.GET;
```

Each implicit member is one greater than the preceding member. This rule also applies after an explicit value:

```Rust
enum Example {
   A: 10,
   B,     // 11
   C      // 12
}
```

## Flow control

Conditions accept numeric values: zero is false and any nonzero value is true.

### `if`, `elif`, and `else`

```Rust
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

```Rust
while (condition) {
   work();
}
```

### `for`

```Rust
for (let index: int = 0; index < count; index += 1) {
   out index;
}
```

The initializer runs once, the condition is tested before each iteration, and the increment runs after each completed body. `continue` executes the increment clause before the next condition check. There is no trailing semicolon after the increment clause.

### Single-statement bodies

Braces may be omitted when an `if`, `elif`, `else`, `while`, or `for` body contains one statement:

```Rust
if (ready) out 1;
while (condition) work();
for (let index = 0; index < count; index += 1) out index;
```

### `break` and `continue`

`break` exits the innermost loop. In a `while` loop, `continue` jumps to the next condition check. In a `for` loop, it executes the increment clause and then checks the condition. Both statements are errors outside a loop.

## Functions and calls

Parameters always have explicit types:

```Rust
fn add(left: int, right: int): int {
   return left + right;
}

let value = add(2, 4);
```

A braced non-`void` function uses `return <expression>`. A `void` function may normally reach the end of its body or use `return;` to exit early. The semicolon is required for the expressionless form because it supplies the empty statement parsed by `return`.

The return type may be omitted when every return expression allows it to be inferred:

```Rust
fn add(left: int, right: int) {
   return left + right;
}
```

An unbraced function consists of one expression and returns it implicitly:

```Rust
fn add(left: int, right: int): int left + right
```

Only expression-bodied functions receive an implicit return. A braced function does not implicitly return its final expression.

Functions may return structs by value, and a returned value may immediately be used in another call, binary expression, index, or member access:

```Rust
out makePoint(3, 4).x;
out add(1, add(2, 3));
```

### Function overloading

Top-level functions may share a name when their parameter type lists differ:

```Rust
fn add(left: int, right: int): int left + right
fn add(left: Point, right: Point): Point {
   // ...
}
```

The argument types select the overload. Return type alone cannot distinguish overloads.

### Function pointers

Function pointers may be stored in variables, struct fields, pointers, and arrays, and are called with the ordinary call syntax:

```Rust
fn increment(value: int): int value + 1

let operation: Fn<int, int> = increment;
out operation(4);
```

## Built-ins and output

### `out`

`out <expression>` accepts only a single-cell expression. It evaluates the expression, removes its cell, and sends that numeric value to the runtime output stream. Strings and aggregate struct values cannot be passed directly to `out`:

```Rust
out 42;
out 'A';
```

### `malloc`

`malloc(size)` allocates the requested number of cells and returns a `void*`. It takes exactly one argument.

### `sizeof`

`sizeof(reference)` returns a compile-time size measured in cells. It takes exactly one reference and does not evaluate that reference as an ordinary expression:

```Rust
out sizeof(int);
out sizeof(Point);
out sizeof(point);
out sizeof(point.x);
```

For an array variable, `sizeof(array)` returns the size of its pointer, not the number of allocated elements.

## Operators

| Operator                  | Symbol |
| ------------------------- | ------ |
| Addition                  | `+`    |
| Subtraction               | `-`    |
| Multiplication            | `*`    |
| Division                  | `/`    |
| Modulo                    | `%`    |
| Numeric negation          | `-`    |
| Bitwise OR                | `\|`   |
| Bitwise AND               | `&`    |
| Bitwise XOR               | `^`    |
| Bitwise NOT               | `~`    |
| Left shift                | `<<`   |
| Signed right shift        | `>>`   |
| Logical OR                | `\|\|` |
| Logical AND               | `&&`   |
| Logical NOT               | `!`    |
| Equality                  | `==`   |
| Inequality                | `!=`   |
| Less than                 | `<`    |
| Less than or equal        | `<=`   |
| Greater than              | `>`    |
| Greater than or equal     | `>=`   |
| Assignment                | `=`    |
| Addition assignment       | `+=`   |
| Subtraction assignment    | `-=`   |
| Multiplication assignment | `*=`   |
| Division assignment       | `/=`   |
| Modulo assignment         | `%=`   |
| Address-of                | `&`    |
| Dereference               | `*`    |

Arithmetic follows the current JavaScript-based runtime. Division evaluates `Math.floor(left / right)`, and modulo evaluates JavaScript's `left % right`. Their behavior for negative, zero, non-finite, or `NaN` operands is the behavior of those JavaScript operations.

Logical `&&` and `||` always evaluate both operands and produce a `bool` represented by `0` or `1`; they do not short-circuit. Comparison results are likewise `bool` values represented by `0` or `1`.

Postfix increment/decrement (`++` and `--`) and compound bitwise/shift assignments are not currently implemented.

Assignments are statements rather than general value-producing expressions.

## Operator precedence

The precedence levels are listed from tightest to loosest. Parentheses override the normal grouping. Binary operators are left-associative; prefix unary operators are right-associative.

| Precedence | Operator    | Description                        | Associativity |
| ---------- | ----------- | ---------------------------------- | ------------- |
| 1          | `()`        | Function call and grouping         | Left to right |
| 1          | `[]`        | Array indexing                     | Left to right |
| 1          | `.`         | Struct member access               | Left to right |
| 1          | `->`        | Struct-pointer member access       | Left to right |
| 2          | `! ~ -`     | Logical NOT, bitwise NOT, negation | Right to left |
| 2          | `* &`       | Dereference, address-of            | Right to left |
| 3          | `* / %`     | Multiplication, division, modulo   | Left to right |
| 4          | `+ -`       | Addition and subtraction           | Left to right |
| 5          | `<< >>`     | Bitwise shifting                   | Left to right |
| 6          | `< <= > >=` | Relational comparison              | Left to right |
| 7          | `== !=`     | Equality comparison                | Left to right |
| 8          | `&`         | Bitwise AND                        | Left to right |
| 9          | `^`         | Bitwise XOR                        | Left to right |
| 10         | `\|`        | Bitwise OR                         | Left to right |
| 11         | `&&`        | Logical AND                        | Left to right |
| 12         | `\|\|`      | Logical OR                         | Left to right |
